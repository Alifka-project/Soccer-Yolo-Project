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
from visualization.soccer_overlay import SoccerOverlayRenderer
from metrics.analyzer import MetricsAnalyzer
import io
import tempfile
import os

app = FastAPI(title="Soccer Tracking Worker")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session storage
sessions: Dict[str, dict] = {}
jobs: Dict[str, dict] = {}

# TTL cleanup
SESSION_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS", "1800"))

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
    sessions[session_id]["video_data"] = video_data
    
    # Probe video info
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(video_data)
        tmp_path = tmp.name
    
    cap = cv2.VideoCapture(tmp_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    os.unlink(tmp_path)
    
    sessions[session_id]["fps"] = fps
    sessions[session_id]["resolution"] = (width, height)
    
    return {"receivedBytes": len(video_data), "done": True}

@app.post("/sessions/{session_id}/jobs")
async def create_job(session_id: str, request: RunJobRequest):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
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
        "fps": sessions[session_id].get("fps"),
        "progressPct": job["progress"],
        "summary": job.get("summary")
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
    processed_frames = session.get("processed_frames", [])
    
    if frame_id >= len(processed_frames):
        raise HTTPException(status_code=404, detail="Frame not found")
    
    frame_data = processed_frames[frame_id]
    frame = frame_data["frame_data"]
    tracks = frame_data["tracks"]
    
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
                await websocket.send_json({"type": "PROGRESS", "pct": pct, "eta_s": eta})
                print(f"Sent progress update: {pct}%")
                last_pct = pct

            if job["status"] == "done":
                await websocket.send_json({"type": "DONE", "summary": job.get("summary", {})})
                print(f"Job {jobId} completed")
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
        if not session.get("video_data"):
            await websocket.send_json({"type": "ERROR", "message": "No video data found"})
            return
            
        # Create temporary video file first to get FPS
        video_data = session["video_data"]
        with tempfile.NamedTemporaryFile(suffix=".mov", delete=False) as tmp:
            tmp.write(video_data)
            tmp_path = tmp.name
        
        cap = cv2.VideoCapture(tmp_path)
        original_fps = cap.get(cv2.CAP_PROP_FPS)
        # Use a fixed 30 FPS for smooth playback regardless of original video FPS
        target_fps = 30.0
        
        # Initialize enhanced soccer tracking components
        detector = EnhancedSoccerDetector(model_name="yolo11s", conf_thresh=0.3)
        tracker = AdvancedMultiObjectTracker(
            track_thresh=0.3,
            match_thresh=0.7,
            max_time_lost=15,
            min_track_length=3
        )
        possession_analyzer = BallPossessionAnalyzer(fps=target_fps, possession_threshold=0.5)
        overlay_renderer = SoccerOverlayRenderer()
        frame_delay = 1.0 / target_fps
        
        print(f"Starting real-time streaming at {target_fps} FPS (original: {original_fps} FPS)")
        
        frame_count = 0
        last_frame_time = time.time()
        last_detection_time = 0
        detection_interval = 10  # Run detection every 10 frames for maximum performance
        last_detections = []
        frame_skip_count = 0
        
        while True:
            # Check if WebSocket is still connected
            if websocket.client_state != websocket.client_state.CONNECTED:
                print("Real-time WebSocket disconnected")
                break
                
            ret, frame = cap.read()
            if not ret:
                # End of video, loop back to beginning
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                frame_count = 0
                continue
            
            # Run detection with enhanced soccer tracking
            if frame_count % detection_interval == 0:
                detections = detector.detect(frame, frame_count)
                tracked_objects = tracker.update(detections)
                
                # Update possession analysis
                possession_analyzer.update_tracks(tracked_objects, frame_count)
                
                last_detections = detections
                last_detection_time = frame_count
                frame_skip_count = 0
            else:
                # Use prediction for intermediate frames
                tracked_objects = tracker.update([])
                
                # Update possession analysis with predicted tracks
                possession_analyzer.update_tracks(tracked_objects, frame_count)
                
                frame_skip_count += 1
                
                # Skip rendering every other frame to improve performance
                if frame_skip_count % 2 == 0:
                    frame_count += 1
                    continue
            
            # Get possession and pass statistics
            possession_stats = possession_analyzer.get_possession_stats()
            pass_stats = possession_analyzer.get_pass_stats()
            
            # Render enhanced soccer overlay
            overlay_frame = overlay_renderer.render_overlay(
                frame, 
                tracked_objects, 
                possession_stats, 
                pass_stats.get('recent_passes', []),
                frame_count
            )
            
            # Prepare enhanced tracking data for WebSocket
            tracking_data = []
            for obj in tracked_objects:
                # Convert numpy types to Python types for JSON serialization
                bbox = [float(x) for x in obj['bbox']]
                tracking_data.append({
                    'track_id': int(obj['track_id']),
                    'bbox': bbox,
                    'class': obj.get('class', 'person'),
                    'confidence': float(obj.get('confidence', obj['score'])),
                    'center': (float(bbox[0] + bbox[2]/2), float(bbox[1] + bbox[3]/2))
                })
            
            # Encode frame as JPEG with maximum performance settings
            _, buffer = cv2.imencode('.jpg', overlay_frame, [
                cv2.IMWRITE_JPEG_QUALITY, 50,  # Much lower quality for maximum speed
                cv2.IMWRITE_JPEG_OPTIMIZE, 1
            ])
            frame_bytes = buffer.tobytes()
            
            # Send frame data with analytics
            try:
                # Send frame bytes
                await websocket.send_bytes(frame_bytes)
                
                # Send analytics data every 30 frames (1 second at 30fps)
                if frame_count % 30 == 0:
                    # Convert numpy types to Python types for JSON serialization
                    safe_possession_stats = {}
                    for key, value in possession_stats.items():
                        if isinstance(value, (np.floating, np.integer)):
                            safe_possession_stats[key] = float(value)
                        else:
                            safe_possession_stats[key] = value
                    
                    safe_pass_stats = {}
                    for key, value in pass_stats.items():
                        if isinstance(value, (np.floating, np.integer)):
                            safe_pass_stats[key] = float(value)
                        elif isinstance(value, list):
                            safe_pass_stats[key] = [float(x) if isinstance(x, (np.floating, np.integer)) else x for x in value]
                        else:
                            safe_pass_stats[key] = value
                    
                    analytics_data = {
                        'type': 'analytics',
                        'frame_id': int(frame_count),
                        'possession_stats': safe_possession_stats,
                        'pass_stats': safe_pass_stats,
                        'tracking_data': tracking_data,
                        'timestamp': float(time.time())
                    }
                    
                    print(f"📊 Sending analytics data for frame {frame_count}: {len(tracking_data)} objects tracked")
                    await websocket.send_json(analytics_data)
                    
            except Exception as e:
                print(f"Error sending frame: {e}")
                break
            
            frame_count += 1
            
            # Aggressive frame rate control for smooth playback
            current_time = time.time()
            elapsed = current_time - last_frame_time
            sleep_time = frame_delay - elapsed
            
            # Only sleep if we're ahead of schedule
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)
            # Don't print frame drops to reduce log spam
            
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
            if 'tmp_path' in locals():
                os.unlink(tmp_path)
            await websocket.close()
            print("Real-time WebSocket connection closed")
        except:
            pass


async def process_video(job_id: str, session_id: str):
    """Background task to process video with YOLO + ByteTrack"""
    try:
        print(f"🚀 REAL TRACKING: Starting video processing for job {job_id}")
        jobs[job_id]["status"] = "running"
        
        # Check if session has video data
        if session_id not in sessions or not sessions[session_id].get("video_data"):
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = "No video data found for session"
            return
        
        # Get video data and create temporary file
        video_data = sessions[session_id]["video_data"]
        fps = sessions[session_id].get("fps", 30)
        
        with tempfile.NamedTemporaryFile(suffix=".mov", delete=False) as tmp:
            tmp.write(video_data)
            tmp_path = tmp.name
        
        # Initialize enhanced tracking components
        print("Initializing Enhanced Soccer Detector...")
        detector = EnhancedSoccerDetector(model_name="yolo11s", conf_thresh=0.3)
        print("Initializing Advanced Multi-Object Tracker...")
        tracker = AdvancedMultiObjectTracker(
            track_thresh=0.3,
            match_thresh=0.7,
            max_time_lost=15,
            min_track_length=3
        )
        print("Initializing Possession Analyzer...")
        possession_analyzer = BallPossessionAnalyzer(fps=fps, possession_threshold=0.5)
        
        # Open video
        print(f"Opening video: {tmp_path}")
        cap = cv2.VideoCapture(tmp_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        print(f"Processing video: {total_frames} frames at {fps} FPS")
        print(f"Video properties: Width={cap.get(cv2.CAP_PROP_FRAME_WIDTH)}, Height={cap.get(cv2.CAP_PROP_FRAME_HEIGHT)}")
        
        # Process frames
        frame_count = 0
        all_tracks = {}
        processed_frames = []
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Run enhanced detection
            detections = detector.detect(frame, frame_count)
            
            # Run tracking
            tracked_objects = tracker.update(detections)
            
            # Update possession analysis
            possession_analyzer.update_tracks(tracked_objects, frame_count)
            
            if frame_count % 30 == 0:  # Log every 30 frames
                print(f"Frame {frame_count}: {len(detections)} detections, {len(tracked_objects)} tracks")
            
            # Store tracking data
            frame_tracks = []
            for obj in tracked_objects:
                track_id = obj['track_id']
                bbox = obj['bbox']
                
                # Store track data
                if track_id not in all_tracks:
                    all_tracks[track_id] = {
                        "id": track_id,
                        "positions": [],
                        "team": "unknown",
                        "jersey": None
                    }
                
                all_tracks[track_id]["positions"].append({
                    "frame": frame_count,
                    "x": bbox[0],
                    "y": bbox[1],
                    "w": bbox[2],
                    "h": bbox[3],
                    "score": obj['score']
                })
                
                frame_tracks.append({
                    "id": track_id,
                    "bbox": bbox,
                    "score": obj['score']
                })
            
            # Store frame data for overlay generation
            processed_frames.append({
                "frame_id": frame_count,
                "tracks": frame_tracks,
                "frame_data": frame
            })
            
            frame_count += 1
            
            # Update progress
            progress = int((frame_count / total_frames) * 100)
            jobs[job_id]["progress"] = progress
            
            # Check if job was cancelled
            if jobs[job_id]["status"] == "cancelled":
                print(f"Job {job_id} was cancelled")
                cap.release()
                os.unlink(tmp_path)
                return
            
            # Yield control to allow WebSocket updates
            if frame_count % 10 == 0:  # Update every 10 frames
                await asyncio.sleep(0.01)
        
        cap.release()
        os.unlink(tmp_path)
        
        # Store processed data in session
        sessions[session_id]["processed_frames"] = processed_frames
        sessions[session_id]["tracks"] = all_tracks
        
        # Get final analytics
        possession_stats = possession_analyzer.get_possession_stats()
        pass_stats = possession_analyzer.get_pass_stats()
        
        # Processing completed successfully
        jobs[job_id]["status"] = "done"
        jobs[job_id]["summary"] = {
            "total_tracks": len(all_tracks),
            "total_frames": frame_count,
            "processing_time": float(frame_count / fps),  # Convert to float for JSON serialization
            "tracks": {str(k): v for k, v in all_tracks.items()},  # Convert keys to strings
            "possession_stats": possession_stats,
            "pass_stats": pass_stats
        }
        
        print(f"Video processing completed for job {job_id}: {len(all_tracks)} tracks found")
        
    except Exception as e:
        print(f"Error processing video for job {job_id}: {e}")
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)

async def cleanup_session(session_id: str):
    """Remove session after TTL expires"""
    await asyncio.sleep(SESSION_TTL_SECONDS)
    if session_id in sessions:
        del sessions[session_id]

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
    uvicorn.run(app, host="0.0.0.0", port=8001)
