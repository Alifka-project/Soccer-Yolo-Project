from ultralytics import YOLO
import numpy as np
import os
import cv2

class YOLODetector:
    def __init__(self, model_name="yolo11n"):
        """Initialize YOLO detector with nano model for maximum speed"""
        self.model_name = model_name
        self.model = YOLO(f"{model_name}.pt")
        
    def detect(self, frame, conf_thresh=0.3):
        """Run detection on a single frame with optimized settings"""
        try:
            # Resize frame for much faster processing
            height, width = frame.shape[:2]
            original_frame = frame
            
            # Resize to smaller size for maximum speed
            target_size = 416  # Smaller size for much faster processing
            if width != target_size or height != target_size:
                frame = cv2.resize(frame, (target_size, target_size))
                scale_x = width / target_size
                scale_y = height / target_size
            else:
                scale_x = scale_y = 1.0
            
            # Run detection with maximum speed settings
            results = self.model(frame, conf=conf_thresh, verbose=False, imgsz=target_size, half=True)
            
            detections = []
            for r in results:
                boxes = r.boxes
                if boxes is not None:
                    for box in boxes:
                        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                        conf = box.conf[0].cpu().numpy()
                        cls = int(box.cls[0].cpu().numpy())
                        
                        # Filter for persons (class 0) and sports balls (class 32)
                        if cls in [0, 32]:
                            # Scale back to original frame size
                            x1 *= scale_x
                            y1 *= scale_y
                            x2 *= scale_x
                            y2 *= scale_y
                            
                            detections.append({
                                'bbox': [x1, y1, x2-x1, y2-y1],
                                'score': conf,
                                'class': 'person' if cls == 0 else 'ball'
                            })
            
            # Only print every 60 frames to reduce log spam
            if hasattr(self, 'frame_count'):
                self.frame_count += 1
            else:
                self.frame_count = 1
            
            if self.frame_count % 60 == 0:
                print(f"Detected {len(detections)} objects in frame {self.frame_count}")
            
            return detections
        except Exception as e:
            print(f"Detection error: {e}")
            return []
    
    def detect_batch(self, frames, conf_thresh=0.25):
        """Run detection on multiple frames"""
        return [self.detect(frame, conf_thresh) for frame in frames]
