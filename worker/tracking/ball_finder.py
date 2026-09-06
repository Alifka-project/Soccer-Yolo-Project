"""Low-confidence YOLO + pitch-blob fallback with short coasting."""
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np


class BallCoaster:
    def __init__(self, max_missed: int = 14):
        self.center: Optional[Tuple[float, float]] = None
        self.velocity = (0.0, 0.0)
        self.size = 10.0
        self.score = 0.0
        self.missed = 0
        self.max_missed = max_missed

    def reset(self):
        self.center = None
        self.velocity = (0.0, 0.0)
        self.size = 10.0
        self.score = 0.0
        self.missed = 0

    def observe(self, bbox: List[float], score: float):
        x, y, w, h = [float(v) for v in bbox]
        cx, cy = x + w / 2.0, y + h / 2.0
        if self.center is not None:
            self.velocity = (cx - self.center[0], cy - self.center[1])
        self.center = (cx, cy)
        self.size = max(w, h, 6.0)
        self.score = float(score)
        self.missed = 0

    def coast(self) -> Optional[Dict]:
        if self.center is None or self.missed >= self.max_missed:
            return None
        self.center = (self.center[0] + self.velocity[0] * 0.85, self.center[1] + self.velocity[1] * 0.85)
        self.velocity = (self.velocity[0] * 0.85, self.velocity[1] * 0.85)
        self.missed += 1
        self.score = max(0.12, self.score * 0.92)
        return self.as_detection(score=self.score, source="coast")

    def as_detection(self, score: float = None, source: str = "track") -> Optional[Dict]:
        if self.center is None:
            return None
        size = self.size
        x = self.center[0] - size / 2.0
        y = self.center[1] - size / 2.0
        return {
            "bbox": [x, y, size, size],
            "score": float(score if score is not None else self.score),
            "class": "ball",
            "class_id": 32,
            "center": self.center,
            "source": source,
        }


def _circularity(contour) -> float:
    area = cv2.contourArea(contour)
    peri = cv2.arcLength(contour, True)
    if peri <= 1 or area <= 1:
        return 0.0
    return float(4.0 * np.pi * area / (peri * peri))


def find_ball_blobs(frame: np.ndarray, previous: Optional[Tuple[float, float]] = None) -> List[Dict]:
    """Find small bright circular blobs on the grass."""
    if frame is None or frame.size == 0:
        return []
    h, w = frame.shape[:2]
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    pitch = cv2.inRange(hsv, (32, 35, 35), (92, 255, 255))
    pitch = cv2.dilate(pitch, np.ones((9, 9), np.uint8), iterations=1)
    bright = cv2.inRange(hsv, (0, 0, 165), (180, 90, 255))
    mask = cv2.bitwise_and(bright, pitch)
    mask = cv2.medianBlur(mask, 5)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < 8 or area > 900:
            continue
        circ = _circularity(contour)
        if circ < 0.45:
            continue
        x, y, bw, bh = cv2.boundingRect(contour)
        size = max(bw, bh)
        if size < 4 or size > 36:
            continue
        ratio = min(bw, bh) / max(bw, bh)
        if ratio < 0.55:
            continue
        cx, cy = x + bw / 2.0, y + bh / 2.0
        score = 0.16 + 0.25 * circ
        if previous is not None:
            dist = np.hypot(cx - previous[0], cy - previous[1])
            if dist < 70:
                score += 0.2
            elif dist > 220:
                score -= 0.08
        candidates.append({
            "bbox": [float(x), float(y), float(bw), float(bh)],
            "score": float(min(0.55, score)),
            "class": "ball",
            "class_id": 32,
            "center": (cx, cy),
            "source": "blob",
        })
    candidates.sort(key=lambda item: item["score"], reverse=True)
    return candidates[:4]


def pick_ball(yolo_balls: List[Dict], blobs: List[Dict], previous: Optional[Tuple[float, float]] = None) -> Optional[Dict]:
    if yolo_balls:
        pool = list(yolo_balls)
    else:
        pool = list(blobs)
        if previous is None:
            pool = [item for item in pool if item.get("score", 0) >= 0.35]
    if not pool:
        return None
    if previous is not None:
        def rank(item):
            cx, cy = item.get("center") or (
                item["bbox"][0] + item["bbox"][2] / 2.0,
                item["bbox"][1] + item["bbox"][3] / 2.0,
            )
            dist = np.hypot(cx - previous[0], cy - previous[1])
            bonus = 0.35 if item.get("source") == "yolo" else 0.0
            return item["score"] + bonus - min(dist, 240) / 400.0
        pool.sort(key=rank, reverse=True)
    else:
        pool.sort(key=lambda item: item["score"] + (0.35 if item.get("source") == "yolo" else 0.0), reverse=True)
    chosen = pool[0]
    if previous is not None and chosen.get("source") != "yolo":
        cx, cy = chosen.get("center") or (
            chosen["bbox"][0] + chosen["bbox"][2] / 2.0,
            chosen["bbox"][1] + chosen["bbox"][3] / 2.0,
        )
        if np.hypot(cx - previous[0], cy - previous[1]) > 140:
            return None
    return chosen
