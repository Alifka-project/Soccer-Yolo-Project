import numpy as np
from collections import defaultdict
import cv2
from typing import List, Dict, Tuple, Optional
import time

class AdvancedTrack:
    """Advanced track with prediction and smoothing capabilities"""
    
    def __init__(self, track_id: int, bbox: List[float], score: float, frame_id: int, class_name: str):
        self.track_id = track_id
        self.bbox = bbox  # [x, y, w, h]
        self.score = score
        self.frame_id = frame_id
        self.class_name = class_name
        self.last_update = frame_id
        self.history = [(bbox, score, frame_id)]
        self.velocity = [0.0, 0.0]  # [vx, vy]
        self.age = 1
        self.confidence_history = [score]
        self.is_confirmed = False
        self.time_since_update = 0
        
        # Kalman filter parameters for smooth tracking
        self.kf_x = bbox[0] + bbox[2] / 2  # center x
        self.kf_y = bbox[1] + bbox[3] / 2  # center y
        self.kf_vx = 0.0
        self.kf_vy = 0.0
        
    def update(self, bbox: List[float], score: float, frame_id: int):
        """Update track with new detection"""
        self.bbox = bbox
        self.score = score
        self.frame_id = frame_id
        self.last_update = frame_id
        self.history.append((bbox, score, frame_id))
        self.age += 1
        self.time_since_update = 0
        
        # Update confidence history
        self.confidence_history.append(score)
        if len(self.confidence_history) > 10:
            self.confidence_history.pop(0)
            
        # Calculate velocity
        if len(self.history) >= 2:
            prev_bbox = self.history[-2][0]
            dt = frame_id - self.history[-2][2]
            if dt > 0:
                self.velocity = [
                    (bbox[0] - prev_bbox[0]) / dt,
                    (bbox[1] - prev_bbox[1]) / dt
                ]
                
                # Update Kalman filter
                self._update_kalman(bbox)
        
        # Confirm track if it has been stable
        if self.age >= 3 and np.mean(self.confidence_history) > 0.5:
            self.is_confirmed = True
    
    def _update_kalman(self, bbox: List[float]):
        """Simple Kalman filter update for smooth tracking"""
        center_x = bbox[0] + bbox[2] / 2
        center_y = bbox[1] + bbox[3] / 2
        
        # Simple prediction and update
        alpha = 0.7  # Smoothing factor
        self.kf_x = alpha * center_x + (1 - alpha) * self.kf_x
        self.kf_y = alpha * center_y + (1 - alpha) * self.kf_y
        
        # Update velocity
        if len(self.history) >= 2:
            prev_center_x = self.history[-2][0][0] + self.history[-2][0][2] / 2
            prev_center_y = self.history[-2][0][1] + self.history[-2][0][3] / 2
            dt = self.frame_id - self.history[-2][2]
            if dt > 0:
                self.kf_vx = alpha * (center_x - prev_center_x) / dt + (1 - alpha) * self.kf_vx
                self.kf_vy = alpha * (center_y - prev_center_y) / dt + (1 - alpha) * self.kf_vy
    
    def predict(self, frame_id: int) -> List[float]:
        """Predict position based on Kalman filter"""
        dt = frame_id - self.frame_id
        if dt > 0:
            # Predict center position
            pred_center_x = self.kf_x + self.kf_vx * dt
            pred_center_y = self.kf_y + self.kf_vy * dt
            
            # Return bbox with original size
            w, h = self.bbox[2], self.bbox[3]
            return [pred_center_x - w/2, pred_center_y - h/2, w, h]
        return self.bbox
    
    def get_smoothed_bbox(self) -> List[float]:
        """Get smoothed bounding box using Kalman filter"""
        w, h = self.bbox[2], self.bbox[3]
        return [self.kf_x - w/2, self.kf_y - h/2, w, h]
    
    def is_active(self) -> bool:
        """Check if track is still active"""
        return self.time_since_update < 10 and self.age > 0
    
    def get_average_confidence(self) -> float:
        """Get average confidence over recent frames"""
        return np.mean(self.confidence_history) if self.confidence_history else 0.0

class AdvancedMultiObjectTracker:
    """Advanced multi-object tracker inspired by Tryolabs approach"""
    
    def __init__(self, 
                 track_thresh: float = 0.3,
                 match_thresh: float = 0.7,
                 max_time_lost: int = 15,
                 min_track_length: int = 3):
        self.track_thresh = track_thresh
        self.match_thresh = match_thresh
        self.max_time_lost = max_time_lost
        self.min_track_length = min_track_length
        self.frame_id = 0
        self.track_id_count = 0
        self.tracks: Dict[int, AdvancedTrack] = {}
        self.lost_tracks: Dict[int, AdvancedTrack] = {}
        self.removed_tracks = set()
        
        # Class-specific tracking parameters
        self.class_params = {
            'person': {'match_thresh': 0.6, 'max_time_lost': 20},
            'ball': {'match_thresh': 0.8, 'max_time_lost': 10}
        }
    
    def update(self, detections: List[Dict]) -> List[Dict]:
        """Update tracker with new detections"""
        self.frame_id += 1
        
        # Update time since last update for all tracks
        for track in self.tracks.values():
            track.time_since_update += 1
        
        if not detections:
            # No detections, predict positions for existing tracks
            return self._predict_tracks()
        
        # Separate detections by class
        person_detections = [d for d in detections if d.get('class') == 'person']
        ball_detections = [d for d in detections if d.get('class') == 'ball']
        
        # Track persons and balls separately
        tracked_objects = []
        
        # Track persons
        if person_detections:
            person_tracks = self._update_class_tracks(person_detections, 'person')
            tracked_objects.extend(person_tracks)
        
        # Track ball
        if ball_detections:
            ball_tracks = self._update_class_tracks(ball_detections, 'ball')
            tracked_objects.extend(ball_tracks)
        
        # Handle lost tracks
        self._handle_lost_tracks()
        
        return tracked_objects
    
    def _update_class_tracks(self, detections: List[Dict], class_name: str) -> List[Dict]:
        """Update tracks for a specific class"""
        if not detections:
            return []
        
        # Get existing tracks for this class
        class_tracks = {tid: track for tid, track in self.tracks.items() 
                       if track.class_name == class_name}
        
        if not class_tracks:
            # Create new tracks for all detections
            tracked_objects = []
            for det in detections:
                if det['score'] > self.track_thresh:
                    track_id = self.track_id_count
                    self.track_id_count += 1
                    
                    track = AdvancedTrack(track_id, det['bbox'], det['score'], 
                                        self.frame_id, class_name)
                    self.tracks[track_id] = track
                    
                    tracked_objects.append({
                        'track_id': int(track_id),
                        'bbox': track.get_smoothed_bbox(),
                        'score': float(track.score),
                        'frame_id': int(self.frame_id),
                        'class': class_name,
                        'confidence': float(track.get_average_confidence())
                    })
            return tracked_objects
        
        # Match detections with existing tracks
        det_bboxes = np.array([d['bbox'] for d in detections])
        det_scores = np.array([d['score'] for d in detections])
        
        matched_tracks, unmatched_dets = self._match_tracks(class_tracks, det_bboxes, det_scores, class_name)
        
        tracked_objects = []
        
        # Update matched tracks
        for track_id, det_idx in matched_tracks:
            track = self.tracks[track_id]
            track.update(det_bboxes[det_idx].tolist(), det_scores[det_idx], self.frame_id)
            tracked_objects.append({
                'track_id': int(track_id),
                'bbox': track.get_smoothed_bbox(),
                'score': float(track.score),
                'frame_id': int(self.frame_id),
                'class': class_name,
                'confidence': float(track.get_average_confidence())
            })
        
        # Create new tracks for unmatched detections
        for det_idx in unmatched_dets:
            if det_scores[det_idx] > self.track_thresh:
                track_id = self.track_id_count
                self.track_id_count += 1
                
                track = AdvancedTrack(track_id, det_bboxes[det_idx].tolist(), 
                                    det_scores[det_idx], self.frame_id, class_name)
                self.tracks[track_id] = track
                
                tracked_objects.append({
                    'track_id': int(track_id),
                    'bbox': track.get_smoothed_bbox(),
                    'score': float(track.score),
                    'frame_id': int(self.frame_id),
                    'class': class_name,
                    'confidence': float(track.get_average_confidence())
                })
        
        return tracked_objects
    
    def _match_tracks(self, tracks: Dict[int, AdvancedTrack], 
                     det_bboxes: np.ndarray, det_scores: np.ndarray, 
                     class_name: str) -> Tuple[List[Tuple[int, int]], List[int]]:
        """Match detections with existing tracks using IoU"""
        if not tracks:
            return [], list(range(len(det_bboxes)))
        
        # Get class-specific parameters
        params = self.class_params.get(class_name, {})
        match_thresh = params.get('match_thresh', self.match_thresh)
        
        # Create cost matrix
        track_ids = list(tracks.keys())
        cost_matrix = np.zeros((len(track_ids), len(det_bboxes)))
        
        for i, track_id in enumerate(track_ids):
            track = tracks[track_id]
            # Use smoothed position for matching
            smoothed_bbox = track.get_smoothed_bbox()
            
            for j, det_bbox in enumerate(det_bboxes):
                iou = self.compute_iou(smoothed_bbox, det_bbox)
                cost_matrix[i, j] = 1 - iou
        
        # Hungarian algorithm for optimal matching
        matched_tracks = []
        unmatched_dets = list(range(len(det_bboxes)))
        
        for i, track_id in enumerate(track_ids):
            best_match = -1
            best_iou = 0
            
            for j in unmatched_dets:
                iou = 1 - cost_matrix[i, j]
                if iou > match_thresh and iou > best_iou:
                    best_match = j
                    best_iou = iou
            
            if best_match != -1:
                matched_tracks.append((track_id, best_match))
                unmatched_dets.remove(best_match)
        
        return matched_tracks, unmatched_dets
    
    def _predict_tracks(self) -> List[Dict]:
        """Predict positions for tracks without detections"""
        tracked_objects = []
        
        for track_id, track in self.tracks.items():
            if track.is_active():
                predicted_bbox = track.predict(self.frame_id)
                tracked_objects.append({
                    'track_id': int(track_id),
                    'bbox': predicted_bbox,
                    'score': float(track.score),
                    'frame_id': int(self.frame_id),
                    'class': track.class_name,
                    'confidence': float(track.get_average_confidence())
                })
        
        return tracked_objects
    
    def _handle_lost_tracks(self):
        """Handle tracks that haven't been updated recently"""
        tracks_to_remove = []
        
        for track_id, track in self.tracks.items():
            if track.time_since_update > self.max_time_lost:
                tracks_to_remove.append(track_id)
        
        for track_id in tracks_to_remove:
            if track_id not in self.removed_tracks:
                self.removed_tracks.add(track_id)
                del self.tracks[track_id]
    
    def compute_iou(self, bbox1: List[float], bbox2: List[float]) -> float:
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
    
    def get_track_statistics(self) -> Dict:
        """Get statistics about current tracks"""
        active_tracks = len(self.tracks)
        confirmed_tracks = sum(1 for track in self.tracks.values() if track.is_confirmed)
        
        return {
            'active_tracks': active_tracks,
            'confirmed_tracks': confirmed_tracks,
            'total_tracks_created': self.track_id_count
        }
