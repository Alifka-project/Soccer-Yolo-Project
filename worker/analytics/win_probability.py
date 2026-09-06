"""Match-state win probability from tracking features."""
import math
from typing import Dict, List, Optional, Tuple


def attacking_thirds(tracked_objects: Optional[List[Dict]] = None, field_width: float = 1280.0) -> Tuple[float, float]:
    people = [obj for obj in (tracked_objects or []) if obj.get("class") != "ball"]
    team_a = [obj for obj in people if obj.get("team") == "team_a"]
    team_b = [obj for obj in people if obj.get("team") == "team_b"]
    width = max(float(field_width) or 1280.0, 1.0)

    def share(items, attack_high_x: bool) -> float:
        if not items:
            return 0.0
        count = 0
        for obj in items:
            box = obj.get("bbox") or [0, 0, 0, 0]
            x = float(box[0]) + float(box[2]) / 2.0
            t = x / width
            if attack_high_x and t > 0.66:
                count += 1
            elif not attack_high_x and t < 0.34:
                count += 1
        return (count / len(items)) * 100.0

    return share(team_a, True), share(team_b, False)


def compute_win_probability(
    possession_stats: Optional[Dict] = None,
    tracked_objects: Optional[List[Dict]] = None,
    field_width: float = 1280.0,
    team_a_passes: int = 0,
    team_b_passes: int = 0,
    attacking_a: float = 0.0,
    attacking_b: float = 0.0,
) -> Dict:
    possession_stats = possession_stats or {}
    tracked_objects = tracked_objects or []
    poss_a = float(possession_stats.get("team_a_percentage") or 0)
    poss_b = float(possession_stats.get("team_b_percentage") or 0)
    poss_time = float(possession_stats.get("total_possession_time") or 0)

    people = [obj for obj in tracked_objects if obj.get("class") != "ball"]
    balls = [obj for obj in tracked_objects if obj.get("class") == "ball"]
    team_a = [obj for obj in people if obj.get("team") == "team_a"]
    team_b = [obj for obj in people if obj.get("team") == "team_b"]

    logit = 0.0
    reasons = []
    if poss_time >= 0.35 and (poss_a + poss_b) > 0:
        logit += ((poss_a - poss_b) / 100.0) * 1.15
        reasons.append("possession")
    if attacking_a or attacking_b:
        logit += ((attacking_a - attacking_b) / 100.0) * 0.75
        reasons.append("field tilt")
    total_passes = team_a_passes + team_b_passes
    if total_passes:
        logit += ((team_a_passes - team_b_passes) / total_passes) * 0.28
        reasons.append("passing")

    width = max(float(field_width) or 1280.0, 1.0)
    if balls:
        bbox = balls[0].get("bbox") or [width / 2, 0, 0, 0]
        ball_x = float(bbox[0]) + float(bbox[2]) / 2.0
        tilt = (ball_x / width - 0.5) * 2.0
        logit += max(-1.0, min(1.0, tilt)) * 0.5
        reasons.append("ball location")
    elif team_a and team_b:
        def mean_x(items):
            xs = []
            for obj in items:
                box = obj.get("bbox") or [0, 0, 0, 0]
                xs.append(float(box[0]) + float(box[2]) / 2.0)
            return sum(xs) / len(xs) if xs else width / 2.0
        tilt = ((mean_x(team_a) - mean_x(team_b)) / width)
        logit += max(-0.6, min(0.6, tilt)) * 0.35
        reasons.append("team shape")

    if not attacking_a and not attacking_b and tracked_objects:
        attacking_a, attacking_b = attacking_thirds(tracked_objects, field_width)
        if attacking_a or attacking_b:
            logit += ((attacking_a - attacking_b) / 100.0) * 0.75
            reasons.append("field tilt")

    prob_a = 1.0 / (1.0 + math.exp(-logit))
    win_a = round(prob_a * 1000) / 10.0
    win_b = round((100.0 - win_a) * 10) / 10.0
    if not people and poss_time <= 0:
        win_a, win_b = 50.0, 50.0
        reasons = ["pre-match"]
    return {
        "team_a": win_a,
        "team_b": win_b,
        "confidence": "high" if poss_time >= 2 or balls else "live",
        "reason": ", ".join(reasons) or "even state",
    }
