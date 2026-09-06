import asyncio
import json
import time
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, WebSocket, UploadFile, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import cv2
import numpy as np
from tracking.detector import YOLODetector
from tracking.tracker import ByteTracker
from tracking.advanced_detector import AdvancedYOLODetector
from tracking.advanced_tracker import AdvancedMultiObjectTracker
from tracking.soccer_detector import EnhancedSoccerDetector
from analytics.possession_analyzer import BallPossessionAnalyzer
from analytics.win_probability import compute_win_probability
from visualization.soccer_overlay import SoccerOverlayRenderer
from metrics.analyzer import MetricsAnalyzer
from tracking.model_config import MODEL_FAMILY, get_device, get_image_size, get_frame_stride, get_model_name
from tracking.team_classifier import classify_tracks_by_color, hex_to_bgr, prune_short_tracks, sample_jersey_bgr
from serialization import jsonable
import io
import tempfile
import os


def assign_track_teams(all_tracks: Dict[Any, Dict], field_width: float = 1280.0) -> Dict[str, str]:
    """Assign teams from jersey color, falling back to field position."""
    return classify_tracks_by_color(all_tracks, default_split_x=field_width / 2.0)
import io
import tempfile
import os

app = FastAPI(title="Soccer Tracking Worker")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session storage
sessions: Dict[str, dict] = {}
jobs: Dict[str, dict] = {}
_detector_cache: Dict[str, YOLODetector] = {}


def _detector_cache_key(model_name: str, imgsz: int) -> str:
    return f"{model_name}:{imgsz}"


def _preview_ready() -> bool:
    return _detector_cache_key(get_model_name("preview"), get_image_size("preview")) in _detector_cache

# TTL cleanup
SESSION_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS", "1800"))
WORKER_PORT = int(os.getenv("PORT", "8000"))

class CreateSessionRequest(BaseModel):
    pass

class RunJobRequest(BaseModel):
    mode: str = "preview"  # preview or publish
    tracker: str = "bytetrack"
    allowReid: bool = False

class CalibrationRequest(BaseModel):
    correspondences: List[Dict[str, float]]

class IdentityEditRequest(BaseModel):
    type: str  # merge, split, rename, reteam, lock
    payload: dict

class ExportRequest(BaseModel):
    kind: str  # csv, mp4, report

@app.get("/health")
async def health():
    return {
        "ok": True,
        "service": "soccer-tracking-worker",
        "model_family": MODEL_FAMILY,
        "model_preview": get_model_name("preview"),
        "model_publish": get_model_name("publish"),
        "device": get_device(),
        "ready": _preview_ready(),
    }

@app.on_event("startup")
async def warmup_detector():
    def _load():
        name = get_model_name("preview")
        imgsz = get_image_size("preview")
        key = _detector_cache_key(name, imgsz)
        print(f"Warming up {MODEL_FAMILY} {name} on {get_device()} (imgsz={imgsz})...")
        _detector_cache[key] = YOLODetector(name, imgsz=imgsz)
        print(f"Warmup complete: {key}")
    await asyncio.to_thread(_load)

@app.post("/sessions")
async def create_session():
    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "id": session_id,
        "created_at": datetime.now(),
        "ttl_seconds": SESSION_TTL_SECONDS,
        "video_data": None,
        "fps": None,
        "resolution": None,
        "tracks": {},
        "calibration": None,
        "locked_ids": set()
    }
    
    # Schedule cleanup
    asyncio.create_task(cleanup_session(session_id))
    
    return {"sessionId": session_id, "ttlSeconds": SESSION_TTL_SECONDS}

@app.post("/sessions/{session_id}/upload")
async def upload_video(session_id: str, file: UploadFile):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Store video in memory/temp
    video_data = await file.read()
    filename = file.filename or "upload.mp4"
    suffix = os.path.splitext(filename)[1] or ".mp4"
    sessions[session_id]["video_data"] = video_data
    sessions[session_id]["filename"] = filename
    
    # Probe video info
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(video_data)
        tmp_path = tmp.name
    
    cap = cv2.VideoCapture(tmp_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()

    sessions[session_id]["video_path"] = tmp_path
    sessions[session_id]["fps"] = fps
    sessions[session_id]["resolution"] = (width, height)
    sessions[session_id]["frame_count"] = frame_count
    sessions[session_id]["video_suffix"] = suffix

    print(
        f"Upload complete for {session_id}: {len(video_data)} bytes, "
        f"{frame_count} frames, {fps} FPS, {width}x{height}"
    )
    return {
        "receivedBytes": len(video_data),
        "done": True,
        "fps": fps,
        "resolution": [width, height],
        "frameCount": frame_count,
    }

@app.post("/sessions/{session_id}/jobs")
async def create_job(session_id: str, request: RunJobRequest):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    if not sessions[session_id].get("video_data"):
        raise HTTPException(
            status_code=400,
            detail="No video uploaded yet. Wait for the upload to finish, then start tracking.",
        )
    
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "id": job_id,
        "session_id": session_id,
        "status": "queued",
        "mode": request.mode,
        "tracker": request.tracker,
        "allow_reid": request.allowReid,
        "progress": 0,
        "created_at": datetime.now()
    }
    
    # Start processing in background
    print(f"🚀 Starting background task for job {job_id}")
    asyncio.create_task(process_video(job_id, session_id))
    
    return {"jobId": job_id}

@app.get("/sessions/{session_id}/jobs/{job_id}")
async def get_job_status(session_id: str, job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    return {
        "status": job["status"],
        "fps": sessions.get(session_id, {}).get("fps"),
        "progressPct": job.get("progress", 0),
        "currentFrame": job.get("current_frame", 0),
        "totalFrames": job.get("total_frames", 0),
        "error": job.get("error"),
        "summary": job.get("summary"),
    }

@app.post("/sessions/{session_id}/calibration")
async def calibrate(session_id: str, request: CalibrationRequest):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Calculate homography from correspondences
    src_pts = np.array([[c["px"], c["py"]] for c in request.correspondences])
    dst_pts = np.array([[c["mx"], c["my"]] for c in request.correspondences])
    
    homography, _ = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC)
    
    # Calculate reprojection error
    transformed = cv2.perspectiveTransform(src_pts.reshape(-1, 1, 2), homography)
    error = np.mean(np.linalg.norm(transformed.reshape(-1, 2) - dst_pts, axis=1))
    
    sessions[session_id]["calibration"] = {
        "homography": homography.tolist(),
        "reprojection_error": float(error)
    }
    
    return {"homography": homography.tolist(), "reprojectionError": float(error)}

@app.post("/sessions/{session_id}/identity-edit")
async def edit_identity(session_id: str, request: IdentityEditRequest):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Apply identity edits to session tracks
    if request.type == "lock":
        track_ids = request.payload.get("track_ids", [])
        sessions[session_id]["locked_ids"].update(track_ids)
    
    # Handle other edit types (merge, split, rename, reteam)
    # Implementation depends on specific requirements
    
    return {"ok": True}

@app.post("/sessions/{session_id}/export")
async def export_data(session_id: str, request: ExportRequest):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = sessions[session_id]
    
    if request.kind == "csv":
        # Generate CSV from tracks
        csv_data = generate_csv(session["tracks"])
        return StreamingResponse(
            io.BytesIO(csv_data.encode()),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=tracks.csv"}
        )
    
    elif request.kind == "mp4":
        # Generate MP4 with overlays
        video_bytes = generate_video_with_overlays(session)
        return StreamingResponse(
            io.BytesIO(video_bytes),
            media_type="video/mp4",
            headers={"Content-Disposition": "attachment; filename=tracking_overlay.mp4"}
        )
    
    elif request.kind == "report":
        # Generate HTML report
        report_html = generate_report(session)
        return StreamingResponse(
            io.BytesIO(report_html.encode()),
            media_type="text/html",
            headers={"Content-Disposition": "attachment; filename=report.html"}
        )
    
    raise HTTPException(status_code=400, detail="Invalid export kind")

@app.options("/sessions/{session_id}/video")
async def options_video(session_id: str):
    """Handle preflight requests for video endpoint"""
    return {"message": "OK"}

@app.get("/sessions/{session_id}/debug")
async def debug_session(session_id: str):
    """Debug endpoint to check session state"""
    if session_id not in sessions:
        return {"error": "Session not found"}
    
    session = sessions[session_id]
    return {
        "session_id": session_id,
        "has_video_data": bool(session.get("video_data")),
        "video_size": len(session.get("video_data", b"")),
        "fps": session.get("fps"),
        "resolution": session.get("resolution"),
        "video_url": f"/sessions/{session_id}/video",
        "has_tracks": bool(session.get("tracks")),
        "track_count": len(session.get("tracks", {}))
    }

@app.get("/sessions/{session_id}/frame/{frame_id}")
async def get_frame_with_overlay(session_id: str, frame_id: int):
    """Get a specific frame with tracking overlays"""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = sessions[session_id]
    video_path = session.get("video_path")
    owned_tmp = False
    if not video_path or not os.path.exists(video_path):
        video_data = session.get("video_data")
        if not video_data:
            raise HTTPException(status_code=404, detail="No video found for session")
        suffix = session.get("video_suffix") or os.path.splitext(session.get("filename", "upload.mp4"))[1] or ".mp4"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(video_data)
            video_path = tmp.name
        owned_tmp = True

    tracks = (session.get("tracks_by_frame") or {}).get(str(frame_id), [])

    cap = cv2.VideoCapture(video_path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_id)
    ret, frame = cap.read()
    cap.release()
    if owned_tmp:
        os.unlink(video_path)

    if not ret or frame is None:
        raise HTTPException(status_code=404, detail="Frame not found")
    
    # Draw tracking overlays
    overlay_frame = frame.copy()
    
    # Define colors for different tracks
    colors = [
        (0, 255, 0),    # Green
        (255, 0, 255),  # Magenta
        (255, 0, 0),    # Blue
        (0, 255, 255),  # Yellow
        (255, 255, 0),  # Cyan
        (128, 0, 128),  # Purple
        (255, 165, 0),  # Orange
        (255, 192, 203), # Pink
    ]
    
    for track in tracks:
        track_id = track["id"]
        bbox = track["bbox"]
        x, y, w, h = bbox
        
        # Choose color based on track ID
        color = colors[track_id % len(colors)]
        
        # Draw bounding box
        cv2.rectangle(overlay_frame, (int(x), int(y)), (int(x + w), int(y + h)), color, 2)
        
        # Draw track ID
        cv2.putText(overlay_frame, str(track_id), (int(x), int(y) - 10), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
    
    # Encode frame as JPEG
    _, buffer = cv2.imencode('.jpg', overlay_frame)
    frame_bytes = buffer.tobytes()
    
    return StreamingResponse(
        io.BytesIO(frame_bytes),
        media_type="image/jpeg",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache"
        }
    )

@app.get("/sessions/{session_id}/tracks")
async def get_tracks(session_id: str):
    """Get all tracking data for a session"""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = sessions[session_id]
    tracks = session.get("tracks", {})
    
    return {
        "session_id": session_id,
        "total_tracks": len(tracks),
        "tracks": tracks
    }

@app.get("/sessions/{session_id}/video")
async def get_video(session_id: str):
    """Serve the uploaded video file"""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    video_data = sessions[session_id].get("video_data")
    if not video_data:
        raise HTTPException(status_code=404, detail="No video found for session")
    
    # Determine content type based on file extension or default to mp4
    # Check if it's a QuickTime file by looking at the file header
    if video_data.startswith(b'\x00\x00\x00\x14ftypqt'):
        # QuickTime files - serve as mp4 for better browser compatibility
        content_type = "video/mp4"
    elif video_data.startswith(b'ftyp'):
        content_type = "video/mp4"
    else:
        content_type = "video/mp4"
    
    return StreamingResponse(
        io.BytesIO(video_data),
        media_type=content_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(len(video_data)),
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Cache-Control": "no-cache"
        }
    )

@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    if session_id in sessions:
        del sessions[session_id]
    return {"ok": True}

@app.websocket("/sessions/{session_id}/stream")
async def websocket_stream(websocket: WebSocket, session_id: str, jobId: str):
    await websocket.accept()
    print(f"WebSocket connection accepted for session {session_id}, job {jobId}")
    
    try:
        last_pct = -1
        while True:
            # Check if WebSocket is still connected
            if websocket.client_state != websocket.client_state.CONNECTED:
                print("WebSocket disconnected")
                break
                
            if jobId not in jobs:
                await websocket.send_json({"type": "ERROR", "message": "job not found"})
                print(f"Job {jobId} not found")
                break

            job = jobs[jobId]
            pct = int(job.get("progress", 0))
            eta = max(0.0, (100 - pct) * 0.1)  # crude ETA from your 0.1s loop

            # send progress updates (not just at the end)
            if pct != last_pct:
                await websocket.send_json({
                    "type": "PROGRESS",
                    "pct": pct,
                    "eta_s": eta,
                    "current_frame": job.get("current_frame", 0),
                    "total_frames": job.get("total_frames", 0),
                })
                print(f"Sent progress update: {pct}% ({job.get('current_frame', 0)}/{job.get('total_frames', 0)})")
                last_pct = pct

            if job["status"] == "done":
                await websocket.send_json({"type": "DONE", "summary": job.get("summary", {})})
                print(f"Job {jobId} completed")
                break

            if job["status"] == "error":
                await websocket.send_json({"type": "ERROR", "message": job.get("error") or "Processing failed"})
                print(f"Job {jobId} failed: {job.get('error')}")
                break

            await asyncio.sleep(0.1)
    except Exception as e:
        print(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "ERROR", "message": str(e)})
        except:
            pass
    finally:
        try:
            await websocket.close()
            print("WebSocket connection closed")
        except:
            pass

@app.websocket("/sessions/{session_id}/realtime")
async def websocket_realtime_stream(websocket: WebSocket, session_id: str):
    """Real-time streaming of video frames with live tracking"""
    try:
        await websocket.accept()
        print(f"Real-time WebSocket connection accepted for session {session_id}")
        
        if session_id not in sessions:
            await websocket.send_json({"type": "ERROR", "message": "Session not found"})
            return
            
        session = sessions[session_id]
        tmp_path = None
        owned_tmp = False
        if session.get("video_path") and os.path.exists(session["video_path"]):
            tmp_path = session["video_path"]
        elif session.get("video_data"):
            video_data = session["video_data"]
            suffix = os.path.splitext(session.get("filename", "upload.mp4"))[1] or ".mp4"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(video_data)
                tmp_path = tmp.name
            owned_tmp = True
        else:
            await websocket.send_json({"type": "ERROR", "message": "No video data found"})
            return
        
        cap = cv2.VideoCapture(tmp_path)
        original_fps = cap.get(cv2.CAP_PROP_FPS)
        # Use a fixed 30 FPS for smooth playback regardless of original video FPS
        target_fps = 30.0
        
        # Initialize enhanced soccer tracking components
        detector = EnhancedSoccerDetector(model_name=get_model_name("preview"), conf_thresh=0.3)
        tracker = AdvancedMultiObjectTracker(
            track_thresh=0.22,
            match_thresh=0.55,
            max_time_lost=25,
            min_track_length=2
        )
        possession_analyzer = BallPossessionAnalyzer(
            fps=target_fps,
            possession_threshold=0.35,
            field_width=float(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280),
        )
        overlay_renderer = SoccerOverlayRenderer()
        frame_delay = 1.0 / target_fps
        
        print(f"Starting real-time streaming at {target_fps} FPS (original: {original_fps} FPS)")
        
        frame_count = 0
        last_frame_time = time.time()
        detection_interval = 4
        live_tracks = {}
        team_colors = {"team_a": "#E11D48", "team_b": "#2563EB"}
        bbox_smooth = {}

        def smooth_bbox(track_id, bbox, alpha=0.58):
            prev = bbox_smooth.get(track_id)
            current = [float(v) for v in bbox]
            if not prev:
                bbox_smooth[track_id] = current
                return current
            mixed = [alpha * b + (1.0 - alpha) * p for b, p in zip(current, prev)]
            bbox_smooth[track_id] = mixed
            return mixed
        
        while True:
            if websocket.client_state != websocket.client_state.CONNECTED:
                print("Real-time WebSocket disconnected")
                break
                
            ret, frame = cap.read()
            if not ret:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                frame_count = 0
                tracker = AdvancedMultiObjectTracker(
                    track_thresh=0.22,
                    match_thresh=0.55,
                    max_time_lost=25,
                    min_track_length=2,
                )
                possession_analyzer.reset()
                detector.ball_state.reset()
                live_tracks = {}
                bbox_smooth = {}
                continue
            
            if frame_count % detection_interval == 0:
                detections = detector.detect(frame, frame_count)
            else:
                detections = detector.detect_ball_only(frame)
            tracked_objects = tracker.update(detections)
            for obj in tracked_objects:
                if obj.get("class") != "person":
                    continue
                sample = sample_jersey_bgr(frame, obj["bbox"])
                if sample is None:
                    continue
                entry = live_tracks.setdefault(int(obj["track_id"]), {"color_samples": [], "class": "person"})
                if len(entry["color_samples"]) < 12:
                    entry["color_samples"].append(sample.tolist())
            if len(live_tracks) >= 6 and frame_count % (detection_interval * 8) == 0:
                team_colors = classify_tracks_by_color(live_tracks, keep_samples=True)

            for obj in tracked_objects:
                tid = int(obj["track_id"])
                info = live_tracks.get(tid) or {}
                obj["team"] = info.get("team", "unknown")
                obj["color"] = info.get("color") or team_colors.get(obj["team"])
                obj["bbox"] = smooth_bbox(tid, obj["bbox"])

            possession_analyzer.update_tracks(tracked_objects, frame_count)
            
            possession_stats = possession_analyzer.get_possession_stats()
            pass_stats = possession_analyzer.get_pass_stats()
            field_width = float(frame.shape[1] or 1280)
            win_probability = compute_win_probability(
                possession_stats=possession_stats,
                tracked_objects=tracked_objects,
                field_width=field_width,
                team_a_passes=int(pass_stats.get("team_a_passes") or 0),
                team_b_passes=int(pass_stats.get("team_b_passes") or 0),
            )
            
            overlay_frame = overlay_renderer.render_overlay(
                frame, 
                tracked_objects, 
                possession_stats, 
                pass_stats.get('recent_passes', []),
                frame_count,
                team_colors,
                win_probability,
            )
            
            tracking_data = []
            for obj in tracked_objects:
                bbox = [float(x) for x in obj['bbox']]
                tracking_data.append({
                    'track_id': int(obj['track_id']),
                    'bbox': bbox,
                    'class': obj.get('class', 'person'),
                    'confidence': float(obj.get('confidence', obj['score'])),
                    'center': [float(bbox[0] + bbox[2]/2), float(bbox[1] + bbox[3]/2)],
                    'team': obj.get('team', 'unknown'),
                    'color': obj.get('color'),
                })
            
            _, buffer = cv2.imencode('.jpg', overlay_frame, [
                cv2.IMWRITE_JPEG_QUALITY, 78,
                cv2.IMWRITE_JPEG_OPTIMIZE, 1
            ])
            frame_bytes = buffer.tobytes()
            
            try:
                await websocket.send_bytes(frame_bytes)
                
                if frame_count % 8 == 0:
                    analytics_data = {
                        'type': 'analytics',
                        'frame_id': int(frame_count),
                        'possession_stats': possession_stats,
                        'pass_stats': pass_stats,
                        'win_probability': win_probability,
                        'tracking_data': tracking_data,
                        'team_colors': team_colors,
                        'timestamp': float(time.time())
                    }
                    print(f"📊 Sending analytics data for frame {frame_count}: {len(tracking_data)} objects tracked")
                    await websocket.send_json(jsonable(analytics_data))
                    
            except Exception as e:
                print(f"Error sending frame: {e}")
                break
            
            frame_count += 1
            
            current_time = time.time()
            elapsed = current_time - last_frame_time
            sleep_time = frame_delay - elapsed
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)
            last_frame_time = time.time()
            
    except Exception as e:
        print(f"Real-time streaming error: {e}")
        try:
            await websocket.send_json({"type": "ERROR", "message": str(e)})
        except:
            pass
    finally:
        try:
            if 'cap' in locals():
                cap.release()
            if owned_tmp and tmp_path:
                os.unlink(tmp_path)
            await websocket.close()
            print("Real-time WebSocket connection closed")
        except:
            pass


def _process_video_sync(job_id: str, video_path: str, detector: YOLODetector, fps: float, stride: int):
    """Run YOLO on a background thread so the WebSocket event loop can send progress."""
    tracker = AdvancedMultiObjectTracker(
        track_thresh=0.22,
        match_thresh=0.55,
        max_time_lost=18,
        min_track_length=2,
    )

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("Could not open the uploaded video. Try MP4 (H.264).")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
    height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    possession_analyzer = BallPossessionAnalyzer(
        fps=max(fps / stride, 1),
        possession_threshold=0.5,
        field_width=float(width or 1280),
    )
    print(f"Processing video: {total_frames} frames at {fps} FPS ({width}x{height}), stride={stride}")

    jobs[job_id]["total_frames"] = total_frames
    jobs[job_id]["progress"] = 1

    frame_count = 0
    processed = 0
    all_tracks = {}
    tracks_by_frame = {}
    started = time.time()

    try:
        while True:
            if jobs[job_id]["status"] == "cancelled":
                return None

            if stride > 1 and frame_count % stride != 0:
                if not cap.grab():
                    break
                frame_count += 1
            else:
                ret, frame = cap.read()
                if not ret:
                    break

                detections = detector.detect(frame, 0.3)
                tracked_objects = tracker.update(detections)
                possession_analyzer.update_tracks(tracked_objects, processed)

                frame_tracks = []
                for obj in tracked_objects:
                    track_id = obj["track_id"]
                    bbox = obj["bbox"]
                    class_name = obj.get("class", "person")
                    if track_id not in all_tracks:
                        all_tracks[track_id] = {
                            "id": int(track_id),
                            "positions": [],
                            "team": "unknown",
                            "jersey": None,
                            "class": class_name,
                            "color_samples": [],
                        }
                    all_tracks[track_id]["positions"].append({
                        "frame": int(frame_count),
                        "x": float(bbox[0]),
                        "y": float(bbox[1]),
                        "w": float(bbox[2]),
                        "h": float(bbox[3]),
                        "score": float(obj["score"]),
                    })
                    if class_name == "person" and processed % 4 == 0:
                        sample = sample_jersey_bgr(frame, bbox)
                        if sample is not None:
                            samples = all_tracks[track_id].setdefault("color_samples", [])
                            if len(samples) < 16:
                                samples.append(sample.tolist())
                    frame_tracks.append({
                        "id": int(track_id),
                        "bbox": [float(x) for x in bbox],
                        "score": float(obj["score"]),
                        "class": class_name,
                    })
                tracks_by_frame[str(frame_count)] = frame_tracks
                processed += 1
                frame_count += 1

                if processed <= 3 or processed % 10 == 0:
                    elapsed = max(time.time() - started, 0.001)
                    print(
                        f"Frame {frame_count}/{total_frames}: {len(detections)} detections, "
                        f"{len(tracked_objects)} tracks, {processed / elapsed:.2f} infer/s"
                    )

            if total_frames > 0:
                jobs[job_id]["progress"] = min(99, max(1, int((frame_count / total_frames) * 100)))
            else:
                jobs[job_id]["progress"] = min(99, 1 + (processed % 98))
            jobs[job_id]["current_frame"] = frame_count
            jobs[job_id]["total_frames"] = total_frames or frame_count
    finally:
        cap.release()

    team_colors = assign_track_teams(all_tracks, field_width=float(width or 1280))
    all_tracks = prune_short_tracks(all_tracks)
    latest_objects = []
    for track in all_tracks.values():
        last = (track.get("positions") or [None])[-1]
        if not last:
            continue
        latest_objects.append({
            "track_id": track.get("id"),
            "class": track.get("class", "person"),
            "team": track.get("team", "unknown"),
            "bbox": [last.get("x", 0), last.get("y", 0), last.get("w", 0), last.get("h", 0)],
        })
    possession_stats = possession_analyzer.get_possession_stats()
    pass_stats = possession_analyzer.get_pass_stats()
    win_probability = compute_win_probability(
        possession_stats=possession_stats,
        tracked_objects=latest_objects,
        field_width=float(width or 1280),
        team_a_passes=int(pass_stats.get("team_a_passes") or 0),
        team_b_passes=int(pass_stats.get("team_b_passes") or 0),
    )

    return {
        "all_tracks": all_tracks,
        "tracks_by_frame": tracks_by_frame,
        "frame_count": frame_count,
        "processed": processed,
        "possession_stats": possession_stats,
        "pass_stats": pass_stats,
        "win_probability": win_probability,
        "elapsed": time.time() - started,
        "fps": fps,
        "width": width,
        "height": height,
        "team_colors": team_colors,
    }


async def process_video(job_id: str, session_id: str):
    """Background task to process video with YOLO + ByteTrack without blocking progress."""
    try:
        print(f"REAL TRACKING: Starting video processing for job {job_id}")
        jobs[job_id]["status"] = "running"
        jobs[job_id]["progress"] = 1

        for _ in range(80):
            session = sessions.get(session_id) or {}
            if session.get("video_path") or session.get("video_data"):
                break
            await asyncio.sleep(0.25)

        session = sessions.get(session_id) or {}
        if not session.get("video_path") and not session.get("video_data"):
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = "No video data found for session. Upload the video first."
            return

        fps = session.get("fps", 30) or 30
        job_mode = jobs[job_id].get("mode", "preview")
        model_name = get_model_name(job_mode)
        imgsz = get_image_size(job_mode)
        stride = max(1, get_frame_stride(job_mode))
        suffix = session.get("video_suffix") or os.path.splitext(session.get("filename", "upload.mp4"))[1] or ".mp4"

        video_path = session.get("video_path")
        owned_tmp = False
        if not video_path or not os.path.exists(video_path):
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(session["video_data"])
                video_path = tmp.name
            owned_tmp = True

        cache_key = _detector_cache_key(model_name, imgsz)
        detector = _detector_cache.get(cache_key)
        jobs[job_id]["total_frames"] = session.get("frame_count") or 0
        jobs[job_id]["current_frame"] = 0
        if detector is None:
            print(f"Loading {MODEL_FAMILY} {model_name} (imgsz={imgsz})...")
            jobs[job_id]["progress"] = 2
            detector = await asyncio.to_thread(YOLODetector, model_name, imgsz)
            _detector_cache[cache_key] = detector

        result = await asyncio.to_thread(
            _process_video_sync, job_id, video_path, detector, fps, stride
        )
        if owned_tmp:
            try:
                os.unlink(video_path)
            except OSError:
                pass

        if result is None or jobs[job_id]["status"] == "cancelled":
            print(f"Job {job_id} was cancelled")
            return

        sessions[session_id]["tracks_by_frame"] = result["tracks_by_frame"]
        sessions[session_id]["tracks"] = result["all_tracks"]
        sessions[session_id]["video_suffix"] = suffix

        jobs[job_id]["status"] = "done"
        jobs[job_id]["progress"] = 100
        jobs[job_id]["summary"] = jsonable({
            "total_tracks": len(result["all_tracks"]),
            "total_frames": result["frame_count"],
            "processed_frames": result["processed"],
            "frame_stride": stride,
            "processing_time": float(result["elapsed"]),
            "tracks": {str(k): v for k, v in result["all_tracks"].items()},
            "possession_stats": result["possession_stats"],
            "pass_stats": result["pass_stats"],
            "win_probability": result.get("win_probability"),
            "model": model_name,
            "model_family": MODEL_FAMILY,
            "fps": fps,
            "frame_stride": stride,
            "resolution": [result.get("width"), result.get("height")],
            "team_colors": result.get("team_colors") or {"team_a": "#E11D48", "team_b": "#2563EB"},
        })
        print(
            f"Video processing completed for job {job_id}: "
            f"{len(result['all_tracks'])} tracks, {result['processed']} analyzed frames "
            f"in {result['elapsed']:.1f}s"
        )

    except Exception as e:
        print(f"Error processing video for job {job_id}: {e}")
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)

async def cleanup_session(session_id: str):
    """Remove session after TTL expires"""
    await asyncio.sleep(SESSION_TTL_SECONDS)
    session = sessions.pop(session_id, None)
    if not session:
        return
    video_path = session.get("video_path")
    if video_path and os.path.exists(video_path):
        try:
            os.unlink(video_path)
        except OSError:
            pass

def generate_csv(tracks):
    """Generate CSV from tracking data"""
    return "frame,track_id,x,y,w,h,team,jersey\n"

def generate_video_with_overlays(session):
    """Generate video with tracking overlays"""
    # Placeholder - would use OpenCV to overlay tracks
    return b""

def generate_report(session):
    """Generate HTML report"""
    return "<html><body><h1>Soccer Tracking Report</h1></body></html>"

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=WORKER_PORT)
