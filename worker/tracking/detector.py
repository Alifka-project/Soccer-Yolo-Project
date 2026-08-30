from ultralytics import YOLO
import numpy as np
import cv2
from tracking.model_config import (
    PERSON_CLASS_ID,
    BALL_CLASS_ID,
    get_device,
    get_model_name,
    use_half_precision,
    weights_path,
)


class YOLODetector:
    def __init__(self, model_name=None):
        """Initialize YOLO26 detector. Defaults to the preview model (yolo26s)."""
        self.model_name = model_name or get_model_name("preview")
        self.device = get_device()
        self.half = use_half_precision(self.device)
        self.model = YOLO(weights_path(self.model_name))
        self.frame_count = 0

    def detect(self, frame, conf_thresh=0.3):
        """Run detection on a single frame with optimized settings"""
        try:
            height, width = frame.shape[:2]
            target_size = 640
            if width != target_size or height != target_size:
                resized = cv2.resize(frame, (target_size, target_size))
                scale_x = width / target_size
                scale_y = height / target_size
            else:
                resized = frame
                scale_x = scale_y = 1.0

            results = self.model(
                resized,
                conf=conf_thresh,
                verbose=False,
                imgsz=target_size,
                half=self.half,
                device=self.device,
                classes=[PERSON_CLASS_ID, BALL_CLASS_ID],
            )

            detections = []
            for r in results:
                boxes = r.boxes
                if boxes is None:
                    continue
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    conf = float(box.conf[0].cpu().numpy())
                    cls = int(box.cls[0].cpu().numpy())

                    if cls not in (PERSON_CLASS_ID, BALL_CLASS_ID):
                        continue

                    x1 *= scale_x
                    y1 *= scale_y
                    x2 *= scale_x
                    y2 *= scale_y

                    detections.append({
                        'bbox': [float(x1), float(y1), float(x2 - x1), float(y2 - y1)],
                        'score': conf,
                        'class': 'person' if cls == PERSON_CLASS_ID else 'ball',
                        'class_id': cls,
                    })

            self.frame_count += 1
            if self.frame_count % 60 == 0:
                print(f"Detected {len(detections)} objects in frame {self.frame_count}")

            return detections
        except Exception as e:
            print(f"Detection error: {e}")
            return []

    def detect_batch(self, frames, conf_thresh=0.25):
        """Run detection on multiple frames"""
        return [self.detect(frame, conf_thresh) for frame in frames]
