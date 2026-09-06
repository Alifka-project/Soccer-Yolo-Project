import os
import sys
import unittest

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from analytics.possession_analyzer import BallPossessionAnalyzer
from analytics.win_probability import compute_win_probability
from tracking.advanced_tracker import AdvancedMultiObjectTracker
from tracking.ball_finder import BallCoaster, find_ball_blobs, pick_ball
from tracking.team_classifier import classify_tracks_by_color, prune_short_tracks, sample_jersey_bgr


class TeamClassifierTests(unittest.TestCase):
    def test_samples_ignore_pitch_and_split_red_blue(self):
        frame = np.zeros((360, 640, 3), dtype=np.uint8)
        frame[:] = (40, 180, 40)
        frame[80:200, 80:160] = (40, 40, 220)
        frame[80:200, 480:560] = (220, 60, 30)

        red = sample_jersey_bgr(frame, [80, 80, 80, 120])
        blue = sample_jersey_bgr(frame, [480, 80, 80, 120])
        self.assertIsNotNone(red)
        self.assertIsNotNone(blue)
        self.assertGreater(float(red[2]), float(red[0]))
        self.assertGreater(float(blue[0]), float(blue[2]))

        tracks = {}
        for i in range(4):
            tracks[i] = {"class": "person", "color_samples": [red.tolist()], "positions": [{"x": 100, "y": 100, "w": 40, "h": 80}]}
        for i in range(4, 8):
            tracks[i] = {"class": "person", "color_samples": [blue.tolist()], "positions": [{"x": 500, "y": 100, "w": 40, "h": 80}]}
        tracks["ball"] = {"class": "ball", "positions": [{"x": 300, "y": 180, "w": 12, "h": 12}]}

        colors = classify_tracks_by_color(tracks)
        teams = {tracks[i]["team"] for i in range(8)}
        self.assertEqual(teams, {"team_a", "team_b"})
        self.assertNotEqual(colors["team_a"].lower(), colors["team_b"].lower())
        self.assertEqual(tracks["ball"]["team"], "ball")

    def test_prune_drops_flicker_ids(self):
        tracks = {
            i: {"class": "person", "positions": [{"x": 0, "y": 0, "w": 10, "h": 10}] * (2 if i > 5 else 20)}
            for i in range(40)
        }
        tracks["ball"] = {"class": "ball", "positions": [{"x": 1, "y": 1, "w": 8, "h": 8}]}
        kept = prune_short_tracks(tracks, min_person_frames=8, max_people=24)
        people = [k for k, v in kept.items() if v.get("class") != "ball"]
        self.assertLessEqual(len(people), 6)
        self.assertTrue(any(v.get("class") == "ball" for v in kept.values()))

    def test_prune_keeps_short_clip_tracks(self):
        tracks = {
            i: {"class": "person", "positions": [{"x": 0, "y": 0, "w": 10, "h": 10}] * 3}
            for i in range(12)
        }
        kept = prune_short_tracks(tracks, min_person_frames=8, max_people=24)
        self.assertGreaterEqual(len(kept), 8)
        self.assertLessEqual(len(kept), 12)


class PossessionTests(unittest.TestCase):
    def _player(self, track_id, x, team, score=0.9):
        return {
            "track_id": track_id,
            "class": "person",
            "bbox": [x, 100, 40, 80],
            "score": score,
            "team": team,
        }

    def test_uses_jersey_team_and_hides_tiny_percentages(self):
        analyzer = BallPossessionAnalyzer(fps=30, possession_threshold=0.35, field_width=1280)
        analyzer.update_tracks([self._player(1, 200, "team_a"), {"track_id": 99, "class": "ball", "bbox": [210, 130, 12, 12], "score": 0.8}], 0)
        stats = analyzer.get_possession_stats()
        self.assertEqual(stats["team_a_percentage"], 0.0)
        self.assertEqual(stats["team_b_percentage"], 0.0)

        for frame in range(1, 25):
            analyzer.update_tracks(
                [self._player(1, 200, "team_a"), {"track_id": 99, "class": "ball", "bbox": [210, 130, 12, 12], "score": 0.8}],
                frame,
            )
        for frame in range(25, 30):
            analyzer.update_tracks(
                [self._player(1, 200, "team_a"), {"track_id": 99, "class": "ball", "bbox": [900, 130, 12, 12], "score": 0.8}],
                frame,
            )
        stats = analyzer.get_possession_stats()
        self.assertGreaterEqual(stats["total_possession_time"], 0.35)
        self.assertGreater(stats["team_a_percentage"], 90)
        self.assertLess(stats["team_b_percentage"], 10)

    def test_same_team_pass_is_deduped(self):
        analyzer = BallPossessionAnalyzer(fps=30, possession_threshold=0.1, field_width=1280)
        for frame in range(0, 12):
            analyzer.update_tracks(
                [self._player(1, 200, "team_a"), self._player(2, 320, "team_a"), {"track_id": 99, "class": "ball", "bbox": [210, 130, 12, 12], "score": 0.8}],
                frame,
            )
        for frame in range(12, 24):
            analyzer.update_tracks(
                [self._player(1, 200, "team_a"), self._player(2, 320, "team_a"), {"track_id": 99, "class": "ball", "bbox": [330, 130, 12, 12], "score": 0.8}],
                frame,
            )
        for frame in range(24, 30):
            analyzer.update_tracks(
                [self._player(1, 200, "team_a"), self._player(2, 320, "team_a"), {"track_id": 99, "class": "ball", "bbox": [900, 130, 12, 12], "score": 0.8}],
                frame,
            )
        passes = analyzer.get_pass_stats()
        self.assertGreaterEqual(passes["total_passes"], 1)
        self.assertEqual(passes["total_passes"], len(passes["recent_passes"]))
        self.assertTrue(all(p.get("from_team") == p.get("to_team") for p in passes["recent_passes"]))


class BallFinderTests(unittest.TestCase):
    def test_finds_white_circle_on_grass(self):
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        frame[:] = (50, 170, 50)
        cv2.circle(frame, (180, 110), 6, (230, 230, 230), -1)
        blobs = find_ball_blobs(frame)
        self.assertGreaterEqual(len(blobs), 1)
        cx, cy = blobs[0]["center"]
        self.assertLess(abs(cx - 180), 12)
        self.assertLess(abs(cy - 110), 12)

    def test_coaster_fills_missed_frames(self):
        coaster = BallCoaster(max_missed=6)
        coaster.observe([100, 100, 10, 10], 0.4)
        coaster.observe([112, 104, 10, 10], 0.4)
        missed = [coaster.coast() for _ in range(3)]
        self.assertTrue(all(item and item["class"] == "ball" for item in missed))
        self.assertGreater(missed[-1]["bbox"][0], 112)

    def test_pick_prefers_nearby_yolo(self):
        yolo = [{"bbox": [400, 200, 8, 8], "score": 0.2, "class": "ball", "center": (404, 204)}]
        blobs = [{"bbox": [10, 10, 8, 8], "score": 0.5, "class": "ball", "center": (14, 14)}]
        chosen = pick_ball(yolo, blobs, previous=(400, 200))
        self.assertEqual(chosen["center"], (404, 204))


class TrackerBallTests(unittest.TestCase):
    def test_keeps_tiny_moving_ball_without_iou(self):
        tracker = AdvancedMultiObjectTracker(track_thresh=0.22)
        first = tracker.update([{"bbox": [100, 100, 8, 8], "score": 0.12, "class": "ball"}])
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0]["class"], "ball")
        ball_id = first[0]["track_id"]
        second = tracker.update([{"bbox": [140, 108, 8, 8], "score": 0.11, "class": "ball"}])
        self.assertEqual(second[0]["track_id"], ball_id)
        coasted = tracker.update([])
        self.assertTrue(any(obj["class"] == "ball" for obj in coasted))

    def test_predicts_players_when_only_ball_arrives(self):
        tracker = AdvancedMultiObjectTracker(track_thresh=0.22)
        tracker.update([{"bbox": [20, 20, 40, 80], "score": 0.8, "class": "person"}])
        mixed = tracker.update([{"bbox": [200, 120, 8, 8], "score": 0.15, "class": "ball"}])
        classes = {obj["class"] for obj in mixed}
        self.assertEqual(classes, {"person", "ball"})


class WinProbabilityTests(unittest.TestCase):
    def test_even_state_is_near_fifty(self):
        result = compute_win_probability()
        self.assertEqual(result["team_a"], 50.0)
        self.assertEqual(result["team_b"], 50.0)
        self.assertAlmostEqual(result["team_a"] + result["team_b"], 100.0)

    def test_possession_and_ball_shift_probability(self):
        even = compute_win_probability(
            possession_stats={"team_a_percentage": 50, "team_b_percentage": 50, "total_possession_time": 4},
            tracked_objects=[{"class": "person", "team": "team_a", "bbox": [200, 100, 40, 80]}],
        )
        favored = compute_win_probability(
            possession_stats={"team_a_percentage": 80, "team_b_percentage": 20, "total_possession_time": 8},
            tracked_objects=[
                {"class": "person", "team": "team_a", "bbox": [200, 100, 40, 80]},
                {"class": "ball", "bbox": [1100, 200, 12, 12]},
            ],
            field_width=1280,
            team_a_passes=6,
            team_b_passes=1,
            attacking_a=70,
            attacking_b=10,
        )
        self.assertGreater(favored["team_a"], even["team_a"])
        self.assertGreater(favored["team_a"], 60)
        self.assertAlmostEqual(favored["team_a"] + favored["team_b"], 100.0, places=1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
