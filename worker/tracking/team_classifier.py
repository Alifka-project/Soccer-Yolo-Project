"""Jersey-color team assignment from player crops."""
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np


PITCH_HUE_MIN = 35
PITCH_HUE_MAX = 85
DEFAULT_A = "#E11D48"
DEFAULT_B = "#2563EB"


def _hex_from_bgr(bgr: np.ndarray) -> str:
    b, g, r = [int(max(0, min(255, v))) for v in bgr]
    return f"#{r:02X}{g:02X}{b:02X}"


def _bgr_from_hex(hex_color: str) -> Tuple[int, int, int]:
    value = hex_color.lstrip("#")
    r, g, b = int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)
    return int(b), int(g), int(r)


def sample_jersey_bgr(frame: np.ndarray, bbox: List[float]) -> Optional[np.ndarray]:
    """Sample the torso region, ignoring grass and extreme highlights."""
    if frame is None or frame.size == 0:
        return None
    h, w = frame.shape[:2]
    x, y, bw, bh = [float(v) for v in bbox]
    x1 = max(0, int(x + bw * 0.22))
    x2 = min(w, int(x + bw * 0.78))
    y1 = max(0, int(y + bh * 0.18))
    y2 = min(h, int(y + bh * 0.62))
    if x2 - x1 < 6 or y2 - y1 < 6:
        return None

    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        return None
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    hue, sat, val = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    mask = (
        ((hue < PITCH_HUE_MIN) | (hue > PITCH_HUE_MAX) | (sat < 40))
        & (sat > 28)
        & (val > 35)
        & (val < 245)
    )
    pixels = crop[mask]
    if len(pixels) < 12:
        pixels = crop.reshape(-1, 3)
        if len(pixels) < 8:
            return None
    return np.median(pixels, axis=0)


def _kmeans_two(samples: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    data = samples.astype(np.float32)
    if len(data) < 2:
        return np.zeros(len(data), dtype=np.int32), data
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 25, 0.5)
    _, labels, centers = cv2.kmeans(data, 2, None, criteria, 6, cv2.KMEANS_PP_CENTERS)
    return labels.flatten(), centers


def classify_tracks_by_color(all_tracks: Dict, default_split_x: Optional[float] = None, keep_samples: bool = False) -> Dict[str, str]:
    """Mutate tracks with team + color. Returns {team_a, team_b} hex colors."""
    player_ids = []
    features = []
    for track_id, track in all_tracks.items():
        if track.get("class") == "ball":
            track["team"] = "ball"
            track["color"] = "#F8FAFC"
            continue
        samples = track.get("color_samples") or []
        if not samples:
            continue
        player_ids.append(track_id)
        features.append(np.median(np.array(samples, dtype=np.float32), axis=0))

    team_colors = {"team_a": DEFAULT_A, "team_b": DEFAULT_B}

    if len(features) >= 4:
        labels, centers = _kmeans_two(np.array(features, dtype=np.float32))
        # Stable naming: cluster with more red (higher R / lower B in BGR) is team_a
        def redness(center):
            b, g, r = center
            return float(r) - float(b)

        if redness(centers[0]) < redness(centers[1]):
            labels = 1 - labels
            centers = centers[::-1]
        team_colors["team_a"] = _hex_from_bgr(centers[0])
        team_colors["team_b"] = _hex_from_bgr(centers[1])
        for track_id, label in zip(player_ids, labels):
            team = "team_a" if int(label) == 0 else "team_b"
            all_tracks[track_id]["team"] = team
            all_tracks[track_id]["color"] = team_colors[team]
    else:
        averages = []
        for track_id, track in all_tracks.items():
            if track.get("class") == "ball":
                continue
            positions = track.get("positions") or []
            if not positions:
                continue
            avg_x = sum(p["x"] + p.get("w", 0) / 2 for p in positions) / len(positions)
            averages.append((track_id, avg_x))
        if averages:
            xs = sorted(x for _, x in averages)
            split = default_split_x if default_split_x else xs[len(xs) // 2]
            for track_id, avg_x in averages:
                team = "team_a" if avg_x < split else "team_b"
                all_tracks[track_id]["team"] = team
                all_tracks[track_id]["color"] = team_colors[team]

    for track in all_tracks.values():
        if not keep_samples:
            track.pop("color_samples", None)
        if track.get("class") != "ball" and not track.get("color"):
            track["color"] = team_colors.get(track.get("team") or "team_a", DEFAULT_A)

    return team_colors


def prune_short_tracks(all_tracks: Dict, min_person_frames: int = 8, max_people: int = 24) -> Dict:
    """Drop flicker IDs; keep the most persistent people plus the ball."""
    people = []
    balls = []
    for track_id, track in all_tracks.items():
        positions = track.get("positions") or []
        if track.get("class") == "ball":
            if positions:
                balls.append((len(positions), track_id, track))
        elif len(positions) >= min_person_frames:
            people.append((len(positions), track_id, track))
    people.sort(reverse=True)
    if not people:
        for track_id, track in all_tracks.items():
            positions = track.get("positions") or []
            if track.get("class") != "ball" and len(positions) >= 2:
                people.append((len(positions), track_id, track))
        people.sort(reverse=True)
    kept = {}
    for _, track_id, track in people[:max_people]:
        kept[track_id] = track
    if balls:
        _, track_id, track = max(balls)
        kept[track_id] = track
    return kept


def hex_to_bgr(hex_color: str) -> Tuple[int, int, int]:
    try:
        return _bgr_from_hex(hex_color)
    except Exception:
        return (40, 40, 225)
