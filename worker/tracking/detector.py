from ultralytics import YOLO
from tracking.model_config import (
    PERSON_CLASS_ID,
    BALL_CLASS_ID,
    get_device,
    get_model_name,
    weights_path,
)
from tracking.ball_finder import BallCoaster, find_ball_blobs, pick_ball


class YOLODetector:
    def __init__(self, model_name=None, imgsz=416):
        """Initialize a single YOLO26 detector for players and ball."""
        self.model_name = model_name or get_model_name("preview")
        self.device = get_device()
        self.imgsz = max(int(imgsz or 640), 640)
        self.model = YOLO(weights_path(self.model_name))
        self.frame_count = 0
        self.ball_state = BallCoaster()

    def detect(self, frame, conf_thresh=0.3):
        """Run detection on a single frame."""
        try:
            infer_kwargs = {
                "conf": 0.08,
                "verbose": False,
                "imgsz": self.imgsz,
                "device": self.device,
                "classes": [PERSON_CLASS_ID, BALL_CLASS_ID],
                "max_det": 60,
            }
            results = self.model(frame, **infer_kwargs)

            detections = []
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
                    if cls == PERSON_CLASS_ID and conf >= 0.22:
                        detections.append({
                            "bbox": bbox,
                            "score": conf,
                            "class": "person",
                            "class_id": cls,
                        })
                    elif cls == BALL_CLASS_ID and conf >= 0.08:
                        yolo_balls.append({
                            "bbox": bbox,
                            "score": conf,
                            "class": "ball",
                            "class_id": cls,
                            "center": (bbox[0] + bbox[2] / 2.0, bbox[1] + bbox[3] / 2.0),
                            "source": "yolo",
                        })

            blobs = find_ball_blobs(frame, self.ball_state.center)
            chosen = pick_ball(yolo_balls, blobs, self.ball_state.center)
            if chosen:
                self.ball_state.observe(chosen["bbox"], chosen["score"])
                detections.append(chosen)
            else:
                coasted = self.ball_state.coast()
                if coasted:
                    detections.append(coasted)

            self.frame_count += 1
            if self.frame_count % 30 == 0:
                ball_src = next((d.get("source") for d in detections if d.get("class") == "ball"), "none")
                print(
                    f"Detected {len(detections)} objects in processed frame {self.frame_count} "
                    f"(ball={ball_src})"
                )
            return detections
        except Exception as e:
            print(f"Detection error: {e}")
            return []
