from ultralytics import YOLO
import numpy as np
import cv2
from typing import List, Dict, Tuple
import time

class AdvancedYOLODetector:
    """Advanced YOLO11 detector optimized for soccer tracking"""
    
    def __init__(self, model_name: str = "yolo11n", conf_thresh: float = 0.3):
        """Initialize YOLO detector with advanced settings"""
        self.model_name = model_name
        self.conf_thresh = conf_thresh
        self.model = YOLO(f"{model_name}.pt")
        
        # Performance tracking
        self.frame_count = 0
        self.detection_times = []
        
        # Detection history for temporal consistency
        self.detection_history = []
        self.max_history = 5
        
        # Class-specific confidence thresholds
        self.class_thresholds = {
            0: 0.25,  # person - lower threshold for better recall
            32: 0.4   # ball - higher threshold for precision
        }
        
        # Frame preprocessing settings
        self.target_size = 416  # Smaller for speed
        self.max_frames_per_second = 30
        
    def detect(self, frame: np.ndarray, frame_id: int = None) -> List[Dict]:
        """Run detection on a single frame with advanced optimizations"""
        start_time = time.time()
        
        try:
            # Preprocess frame
            processed_frame, scale_x, scale_y = self._preprocess_frame(frame)
            
            # Run detection with optimized settings
            results = self.model(
                processed_frame, 
                conf=self.conf_thresh,
                verbose=False,
                imgsz=self.target_size,
                half=False,  # Disable half precision to avoid CPU errors
                device='cpu'  # Force CPU for consistency
            )
            
            # Process results
            detections = self._process_results(results, scale_x, scale_y)
            
            # Apply temporal filtering
            detections = self._apply_temporal_filtering(detections, frame_id)
            
            # Update performance metrics
            detection_time = time.time() - start_time
            self.detection_times.append(detection_time)
            if len(self.detection_times) > 100:
                self.detection_times.pop(0)
            
            self.frame_count += 1
            
            # Log performance every 100 frames
            if self.frame_count % 100 == 0:
                avg_time = np.mean(self.detection_times)
                fps = 1.0 / avg_time if avg_time > 0 else 0
                print(f"Detection performance: {avg_time:.3f}s/frame, {fps:.1f} FPS")
            
            return detections
            
        except Exception as e:
            print(f"Detection error: {e}")
            return []
    
    def _preprocess_frame(self, frame: np.ndarray) -> Tuple[np.ndarray, float, float]:
        """Preprocess frame for optimal detection performance"""
        height, width = frame.shape[:2]
        
        # Resize to target size while maintaining aspect ratio
        if width != self.target_size or height != self.target_size:
            # Calculate scale factors
            scale = min(self.target_size / width, self.target_size / height)
            new_width = int(width * scale)
            new_height = int(height * scale)
            
            # Resize frame
            processed_frame = cv2.resize(frame, (new_width, new_height))
            
            # Pad to target size if needed
            if new_width != self.target_size or new_height != self.target_size:
                pad_x = (self.target_size - new_width) // 2
                pad_y = (self.target_size - new_height) // 2
                processed_frame = cv2.copyMakeBorder(
                    processed_frame, pad_y, pad_y, pad_x, pad_x,
                    cv2.BORDER_CONSTANT, value=(114, 114, 114)  # Gray padding
                )
            
            scale_x = width / self.target_size
            scale_y = height / self.target_size
        else:
            processed_frame = frame
            scale_x = scale_y = 1.0
        
        return processed_frame, scale_x, scale_y
    
    def _process_results(self, results, scale_x: float, scale_y: float) -> List[Dict]:
        """Process YOLO results and convert to our format"""
        detections = []
        
        for r in results:
            boxes = r.boxes
            if boxes is not None:
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    conf = box.conf[0].cpu().numpy()
                    cls = int(box.cls[0].cpu().numpy())
                    
                    # Filter for soccer-relevant classes
                    if cls in [0, 32]:  # person, ball
                        # Apply class-specific threshold
                        class_thresh = self.class_thresholds.get(cls, self.conf_thresh)
                        if conf < class_thresh:
                            continue
                        
                        # Scale back to original frame size
                        x1 *= scale_x
                        y1 *= scale_y
                        x2 *= scale_x
                        y2 *= scale_y
                        
                        # Convert to [x, y, w, h] format
                        bbox = [x1, y1, x2 - x1, y2 - y1]
                        
                        # Determine class name
                        class_name = 'person' if cls == 0 else 'ball'
                        
                        detections.append({
                            'bbox': bbox,
                            'score': float(conf),
                            'class': class_name,
                            'class_id': cls
                        })
        
        return detections
    
    def _apply_temporal_filtering(self, detections: List[Dict], frame_id: int = None) -> List[Dict]:
        """Apply temporal filtering to reduce false positives"""
        if frame_id is None:
            return detections
        
        # Store detection history
        self.detection_history.append({
            'frame_id': frame_id,
            'detections': detections.copy()
        })
        
        if len(self.detection_history) > self.max_history:
            self.detection_history.pop(0)
        
        # If we don't have enough history, return as is
        if len(self.detection_history) < 3:
            return detections
        
        # Apply temporal consistency filtering
        filtered_detections = []
        
        for det in detections:
            # Check if this detection appears consistently in recent frames
            consistency_score = self._calculate_consistency(det)
            
            # Only keep detections with high temporal consistency
            if consistency_score > 0.5:
                filtered_detections.append(det)
        
        return filtered_detections
    
    def _calculate_consistency(self, detection: Dict) -> float:
        """Calculate temporal consistency score for a detection"""
        if len(self.detection_history) < 2:
            return 1.0
        
        class_name = detection['class']
        bbox = detection['bbox']
        
        # Count how many recent frames have similar detections
        consistent_frames = 0
        total_frames = len(self.detection_history) - 1
        
        for i in range(1, len(self.detection_history)):
            prev_detections = self.detection_history[i]['detections']
            
            # Find similar detection in previous frame
            for prev_det in prev_detections:
                if prev_det['class'] == class_name:
                    iou = self._compute_iou(bbox, prev_det['bbox'])
                    if iou > 0.3:  # Similar position
                        consistent_frames += 1
                        break
        
        return consistent_frames / total_frames if total_frames > 0 else 0.0
    
    def _compute_iou(self, bbox1: List[float], bbox2: List[float]) -> float:
        """Calculate IoU between two bboxes"""
        x1, y1, w1, h1 = bbox1
        x2, y2, w2, h2 = bbox2
        
        xi1 = max(x1, x2)
        yi1 = max(y1, y2)
        xi2 = min(x1 + w1, x2 + w2)
        yi2 = min(y1 + h1, y2 + h2)
        
        inter_area = max(0, xi2 - xi1) * max(0, yi2 - yi1)
        
        box1_area = w1 * h1
        box2_area = w2 * h2
        union_area = box1_area + box2_area - inter_area
        
        return inter_area / union_area if union_area > 0 else 0
    
    def detect_batch(self, frames: List[np.ndarray]) -> List[List[Dict]]:
        """Run detection on multiple frames (for batch processing)"""
        return [self.detect(frame, i) for i, frame in enumerate(frames)]
    
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
    
    def reset_performance_stats(self):
        """Reset performance statistics"""
        self.detection_times = []
        self.frame_count = 0
        self.detection_history = []
