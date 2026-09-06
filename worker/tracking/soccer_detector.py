from ultralytics import YOLO
import numpy as np
import cv2
from typing import List, Dict, Tuple, Optional
import time
from tracking.model_config import (
    BALL_CLASS_ID,
    PERSON_CLASS_ID,
    get_device,
    get_model_name,
    use_half_precision,
    weights_path,
)
from tracking.ball_finder import BallCoaster, find_ball_blobs, pick_ball

class SoccerBallDetector:
    """Specialized soccer ball detector with enhanced accuracy"""
    
    def __init__(self, model_name: str = None, conf_thresh: float = 0.4, model: Optional[YOLO] = None):
        """Initialize soccer ball detector"""
        self.model_name = model_name or get_model_name("preview")
        self.conf_thresh = conf_thresh
        self.device = get_device()
        self.half = use_half_precision(self.device)
        self.model = model or YOLO(weights_path(self.model_name))
        
        # Ball-specific parameters
        self.ball_class_id = BALL_CLASS_ID  # Sports ball class in COCO
        self.min_ball_size = 5   # Minimum ball size in pixels
        self.max_ball_size = 100 # Maximum ball size in pixels
        
        # Temporal filtering for ball detection
        self.ball_history = []
        self.max_history = 10
        self.temporal_threshold = 0.3
        
        # Performance tracking
        self.frame_count = 0
        self.detection_times = []
        
    def detect_ball(self, frame: np.ndarray, frame_id: int = None) -> List[Dict]:
        """Detect soccer ball with enhanced accuracy"""
        start_time = time.time()
        
        try:
            results = self.model(
                frame,
                conf=0.08,
                verbose=False,
                imgsz=max(640, 960 if min(frame.shape[:2]) >= 400 else 640),
                half=self.half,
                device=self.device,
                classes=[self.ball_class_id],
            )
            
            # Process results for ball detection
            ball_detections = self._process_ball_results(results, frame.shape)
            
            # Update performance metrics
            detection_time = time.time() - start_time
            self.detection_times.append(detection_time)
            if len(self.detection_times) > 100:
                self.detection_times.pop(0)
            
            self.frame_count += 1
            
            return ball_detections
            
        except Exception as e:
            print(f"Ball detection error: {e}")
            return []
    
    def _preprocess_for_ball(self, frame: np.ndarray) -> np.ndarray:
        """Preprocess frame specifically for ball detection"""
        # Enhance contrast for better ball detection
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        
        # Apply CLAHE to L channel
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        
        # Merge channels back
        enhanced = cv2.merge([l, a, b])
        enhanced = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
        
        return enhanced
    
    def _process_ball_results(self, results, original_shape: Tuple[int, int]) -> List[Dict]:
        """Process YOLO results specifically for ball detection"""
        ball_detections = []
        height, width = original_shape[:2]
        
        for r in results:
            boxes = r.boxes
            if boxes is not None:
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    conf = box.conf[0].cpu().numpy()
                    cls = int(box.cls[0].cpu().numpy())
                    
                    # Only process ball detections
                    if cls == self.ball_class_id:
                        # Scale to original frame size
                        x1 = max(0, min(width, x1))
                        y1 = max(0, min(height, y1))
                        x2 = max(0, min(width, x2))
                        y2 = max(0, min(height, y2))
                        
                        # Calculate ball size
                        ball_width = x2 - x1
                        ball_height = y2 - y1
                        ball_size = max(ball_width, ball_height)
                        
                        if 3 <= ball_size <= 80:
                            # Convert to [x, y, w, h] format
                            bbox = [x1, y1, ball_width, ball_height]
                            
                            ball_detections.append({
                                'bbox': bbox,
                                'score': float(conf),
                                'class': 'ball',
                                'class_id': self.ball_class_id,
                                'size': ball_size,
                                'center': (x1 + ball_width/2, y1 + ball_height/2)
                            })
        
        return ball_detections
    
    def _apply_temporal_filtering(self, detections: List[Dict], frame_id: int = None) -> List[Dict]:
        """Apply temporal filtering to reduce false positives"""
        if frame_id is None:
            return detections
        
        # Store detection history
        self.ball_history.append({
            'frame_id': frame_id,
            'detections': detections.copy()
        })
        
        if len(self.ball_history) > self.max_history:
            self.ball_history.pop(0)
        
        # If we don't have enough history, return as is
        if len(self.ball_history) < 3:
            return detections
        
        # Apply temporal consistency filtering
        filtered_detections = []
        
        for det in detections:
            # Check if this detection appears consistently in recent frames
            consistency_score = self._calculate_ball_consistency(det)
            
            # Only keep detections with high temporal consistency
            if consistency_score > self.temporal_threshold:
                filtered_detections.append(det)
        
        return filtered_detections
    
    def _calculate_ball_consistency(self, detection: Dict) -> float:
        """Calculate temporal consistency score for ball detection"""
        if len(self.ball_history) < 2:
            return 1.0
        
        bbox = detection['bbox']
        center = detection['center']
        
        # Count how many recent frames have similar ball detections
        consistent_frames = 0
        total_frames = len(self.ball_history) - 1
        
        for i in range(1, len(self.ball_history)):
            prev_detections = self.ball_history[i]['detections']
            
            # Find similar ball detection in previous frame
            for prev_det in prev_detections:
                prev_center = prev_det['center']
                distance = np.sqrt((center[0] - prev_center[0])**2 + 
                                 (center[1] - prev_center[1])**2)
                
                if distance < 50:  # Similar position
                    consistent_frames += 1
                    break
        
        return consistent_frames / total_frames if total_frames > 0 else 0.0
    
    def get_performance_stats(self) -> Dict:
        """Get performance statistics"""
        if not self.detection_times:
            return {'avg_time': 0, 'fps': 0, 'total_frames': 0}
        
        avg_time = np.mean(self.detection_times)
        fps = 1.0 / avg_time if avg_time > 0 else 0
        
        return {
            'avg_time': avg_time,
            'fps': fps,
            'total_frames': self.frame_count,
            'recent_times': self.detection_times[-10:] if len(self.detection_times) >= 10 else self.detection_times
        }

class EnhancedSoccerDetector:
    """Enhanced soccer detector combining player and ball detection"""
    
    def __init__(self, model_name: str = None, conf_thresh: float = 0.3):
        """Initialize enhanced soccer detector with YOLO26."""
        self.model_name = model_name or get_model_name("preview")
        self.conf_thresh = conf_thresh
        self.device = get_device()
        self.half = use_half_precision(self.device)
        self.model = YOLO(weights_path(self.model_name))
        
        # Specialized detectors share the same weights to avoid loading YOLO twice
        self.ball_detector = SoccerBallDetector(self.model_name, 0.08, model=self.model)
        self.ball_state = BallCoaster()
        
        # Class-specific parameters
        self.class_thresholds = {
            PERSON_CLASS_ID: 0.22,
            BALL_CLASS_ID: 0.08,
        }
        
        # Performance tracking
        self.frame_count = 0
        self.detection_times = []
        
    def detect_ball_only(self, frame: np.ndarray) -> List[Dict]:
        """Cheap ball update for skipped player-inference frames."""
        blobs = find_ball_blobs(frame, self.ball_state.center)
        chosen = pick_ball([], blobs, self.ball_state.center)
        if chosen:
            self.ball_state.observe(chosen["bbox"], chosen["score"])
            return [chosen]
        coasted = self.ball_state.coast()
        return [coasted] if coasted else []

    def detect(self, frame: np.ndarray, frame_id: int = None) -> List[Dict]:
        """Detect players and ball with a single YOLO pass plus pitch fallback."""
        start_time = time.time()
        
        try:
            results = self.model(
                frame,
                conf=0.08,
                verbose=False,
                imgsz=640,
                half=self.half,
                device=self.device,
                classes=[PERSON_CLASS_ID, BALL_CLASS_ID],
                max_det=60,
            )
            player_detections = []
            yolo_balls = []
            for r in results:
                boxes = r.boxes
                if boxes is None:
                    continue
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    conf = float(box.conf[0].cpu().numpy())
                    cls = int(box.cls[0].cpu().numpy())
                    bbox = [float(x1), float(y1), float(x2 - x1), float(y2 - y1)]
                    if cls == PERSON_CLASS_ID and conf >= self.class_thresholds[PERSON_CLASS_ID]:
                        player_detections.append({
                            'bbox': bbox,
                            'score': conf,
                            'class': 'person',
                            'class_id': PERSON_CLASS_ID,
                        })
                    elif cls == BALL_CLASS_ID and conf >= self.class_thresholds[BALL_CLASS_ID]:
                        yolo_balls.append({
                            'bbox': bbox,
                            'score': conf,
                            'class': 'ball',
                            'class_id': BALL_CLASS_ID,
                            'center': (bbox[0] + bbox[2] / 2.0, bbox[1] + bbox[3] / 2.0),
                            'source': 'yolo',
                        })
            blobs = find_ball_blobs(frame, self.ball_state.center)
            chosen = pick_ball(yolo_balls, blobs, self.ball_state.center)
            if chosen:
                self.ball_state.observe(chosen["bbox"], chosen["score"])
                ball_detections = [chosen]
            else:
                coasted = self.ball_state.coast()
                ball_detections = [coasted] if coasted else []
            all_detections = player_detections + ball_detections
            
            # Update performance metrics
            detection_time = time.time() - start_time
            self.detection_times.append(detection_time)
            if len(self.detection_times) > 100:
                self.detection_times.pop(0)
            
            self.frame_count += 1
            
            return all_detections
            
        except Exception as e:
            print(f"Enhanced detection error: {e}")
            return []
    
    def _detect_players(self, frame: np.ndarray) -> List[Dict]:
        """Detect players with YOLO letterboxing (no aspect-ratio warp)."""
        try:
            results = self.model(
                frame,
                conf=self.conf_thresh,
                verbose=False,
                imgsz=640,
                half=self.half,
                device=self.device,
                classes=[PERSON_CLASS_ID],
                max_det=40,
            )

            player_detections = []
            for r in results:
                boxes = r.boxes
                if boxes is None:
                    continue
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    conf = float(box.conf[0].cpu().numpy())
                    cls = int(box.cls[0].cpu().numpy())
                    if cls != PERSON_CLASS_ID:
                        continue
                    if conf < self.class_thresholds[PERSON_CLASS_ID]:
                        continue
                    player_detections.append({
                        'bbox': [float(x1), float(y1), float(x2 - x1), float(y2 - y1)],
                        'score': conf,
                        'class': 'person',
                        'class_id': 0,
                    })
            return player_detections
        except Exception as e:
            print(f"Player detection error: {e}")
            return []
    
    def get_performance_stats(self) -> Dict:
        """Get performance statistics"""
        if not self.detection_times:
            return {'avg_time': 0, 'fps': 0, 'total_frames': 0}
        
        avg_time = np.mean(self.detection_times)
        fps = 1.0 / avg_time if avg_time > 0 else 0
        
        ball_stats = self.ball_detector.get_performance_stats()
        
        return {
            'avg_time': avg_time,
            'fps': fps,
            'total_frames': self.frame_count,
            'ball_detector_stats': ball_stats,
            'recent_times': self.detection_times[-10:] if len(self.detection_times) >= 10 else self.detection_times
        }
