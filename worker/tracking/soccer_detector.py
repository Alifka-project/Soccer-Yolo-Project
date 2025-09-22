from ultralytics import YOLO
import numpy as np
import cv2
from typing import List, Dict, Tuple
import time

class SoccerBallDetector:
    """Specialized soccer ball detector with enhanced accuracy"""
    
    def __init__(self, model_name: str = "yolo11s", conf_thresh: float = 0.4):
        """Initialize soccer ball detector"""
        self.model_name = model_name
        self.conf_thresh = conf_thresh
        self.model = YOLO(f"{model_name}.pt")
        
        # Ball-specific parameters
        self.ball_class_id = 32  # Sports ball class in COCO
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
            # Preprocess frame for better ball detection
            processed_frame = self._preprocess_for_ball(frame)
            
            # Run detection
            results = self.model(
                processed_frame,
                conf=self.conf_thresh,
                verbose=False,
                imgsz=640,
                half=False  # Disable half precision to avoid CPU errors
            )
            
            # Process results for ball detection
            ball_detections = self._process_ball_results(results, frame.shape)
            
            # Apply temporal filtering
            ball_detections = self._apply_temporal_filtering(ball_detections, frame_id)
            
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
                        
                        # Filter by ball size
                        if self.min_ball_size <= ball_size <= self.max_ball_size:
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
    
    def __init__(self, model_name: str = "yolo11s", conf_thresh: float = 0.3):
        """Initialize enhanced soccer detector"""
        self.model_name = model_name
        self.conf_thresh = conf_thresh
        self.model = YOLO(f"{model_name}.pt")
        
        # Specialized detectors
        self.ball_detector = SoccerBallDetector(model_name, conf_thresh + 0.1)
        
        # Class-specific parameters
        self.class_thresholds = {
            0: 0.25,   # person - lower threshold for better recall
            32: 0.4    # ball - higher threshold for precision
        }
        
        # Performance tracking
        self.frame_count = 0
        self.detection_times = []
        
    def detect(self, frame: np.ndarray, frame_id: int = None) -> List[Dict]:
        """Detect players and ball with enhanced accuracy"""
        start_time = time.time()
        
        try:
            # Detect players using standard YOLO
            player_detections = self._detect_players(frame)
            
            # Detect ball using specialized detector
            ball_detections = self.ball_detector.detect_ball(frame, frame_id)
            
            # Combine detections
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
        """Detect players using standard YOLO"""
        try:
            # Resize frame for faster processing
            height, width = frame.shape[:2]
            target_size = 640
            
            if width != target_size or height != target_size:
                frame_resized = cv2.resize(frame, (target_size, target_size))
                scale_x = width / target_size
                scale_y = height / target_size
            else:
                frame_resized = frame
                scale_x = scale_y = 1.0
            
            # Run detection
            results = self.model(
                frame_resized,
                conf=self.conf_thresh,
                verbose=False,
                imgsz=target_size,
                half=False  # Disable half precision to avoid CPU errors
            )
            
            # Process results for players only
            player_detections = []
            for r in results:
                boxes = r.boxes
                if boxes is not None:
                    for box in boxes:
                        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                        conf = box.conf[0].cpu().numpy()
                        cls = int(box.cls[0].cpu().numpy())
                        
                        # Only process person detections
                        if cls == 0:  # person class
                            # Apply class-specific threshold
                            if conf < self.class_thresholds[0]:
                                continue
                            
                            # Scale back to original frame size
                            x1 *= scale_x
                            y1 *= scale_y
                            x2 *= scale_x
                            y2 *= scale_y
                            
                            # Convert to [x, y, w, h] format
                            bbox = [x1, y1, x2 - x1, y2 - y1]
                            
                            player_detections.append({
                                'bbox': bbox,
                                'score': float(conf),
                                'class': 'person',
                                'class_id': 0
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
