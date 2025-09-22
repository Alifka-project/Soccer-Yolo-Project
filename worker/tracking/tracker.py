import numpy as np
from collections import defaultdict
import time

class Track:
    def __init__(self, track_id, bbox, score, frame_id):
        self.track_id = track_id
        self.bbox = bbox
        self.score = score
        self.frame_id = frame_id
        self.last_update = frame_id
        self.history = [(bbox, score, frame_id)]
        self.velocity = [0, 0]  # [vx, vy]
        self.age = 1
        
    def update(self, bbox, score, frame_id):
        self.bbox = bbox
        self.score = score
        self.frame_id = frame_id
        self.last_update = frame_id
        self.history.append((bbox, score, frame_id))
        self.age += 1
        
        # Calculate velocity for prediction
        if len(self.history) >= 2:
            prev_bbox = self.history[-2][0]
            dt = frame_id - self.history[-2][2]
            if dt > 0:
                self.velocity = [
                    (bbox[0] - prev_bbox[0]) / dt,
                    (bbox[1] - prev_bbox[1]) / dt
                ]
    
    def predict(self, frame_id):
        """Predict position based on velocity with smoothing"""
        dt = frame_id - self.frame_id
        if dt > 0 and self.velocity != [0, 0]:
            # Apply smoothing factor to reduce jitter
            smoothing_factor = 0.7
            predicted_bbox = [
                self.bbox[0] + self.velocity[0] * dt * smoothing_factor,
                self.bbox[1] + self.velocity[1] * dt * smoothing_factor,
                self.bbox[2],  # width
                self.bbox[3]   # height
            ]
            return predicted_bbox
        return self.bbox
    
    def interpolate_position(self, target_frame_id):
        """Interpolate position between current and predicted position"""
        if len(self.history) < 2:
            return self.bbox
            
        # Get last two positions
        prev_bbox, _, prev_frame = self.history[-2]
        curr_bbox, _, curr_frame = self.history[-1]
        
        # Calculate interpolation factor
        if curr_frame == prev_frame:
            return curr_bbox
            
        alpha = (target_frame_id - prev_frame) / (curr_frame - prev_frame)
        alpha = max(0, min(1, alpha))  # Clamp between 0 and 1
        
        # Linear interpolation
        interpolated_bbox = [
            prev_bbox[0] + alpha * (curr_bbox[0] - prev_bbox[0]),
            prev_bbox[1] + alpha * (curr_bbox[1] - prev_bbox[1]),
            prev_bbox[2] + alpha * (curr_bbox[2] - prev_bbox[2]),
            prev_bbox[3] + alpha * (curr_bbox[3] - prev_bbox[3])
        ]
        
        return interpolated_bbox
    
    def is_active(self):
        """Check if track is still active (not too old)"""
        return self.age > 0 and len(self.history) > 0

class ByteTracker:
    def __init__(self, track_thresh=0.3, match_thresh=0.7, max_time_lost=10):
        """Initialize ByteTrack tracker with improved continuity"""
        self.track_thresh = track_thresh
        self.match_thresh = match_thresh
        self.max_time_lost = max_time_lost
        self.frame_id = 0
        self.track_id_count = 0
        self.tracks = {}  # active tracks
        self.lost_tracks = {}  # lost tracks
        self.removed_tracks = set()
        
    def update(self, detections):
        """Update tracker with new detections"""
        self.frame_id += 1
        
        # Convert detections to numpy array
        if len(detections) == 0:
            # No detections, predict positions for existing tracks
            tracked_objects = []
            for track_id, track in self.tracks.items():
                if track.is_active():
                    # Predict position based on velocity
                    predicted_bbox = track.predict(self.frame_id)
                    tracked_objects.append({
                        'track_id': int(track_id),
                        'bbox': [float(x) for x in predicted_bbox],
                        'score': float(track.score),
                        'frame_id': int(self.frame_id)
                    })
            return tracked_objects
        
        det_bboxes = np.array([d['bbox'] for d in detections])
        det_scores = np.array([d['score'] for d in detections])
        
        # Match detections with existing tracks
        matched_tracks, unmatched_dets = self._match_tracks(det_bboxes, det_scores)
        
        # Update matched tracks
        tracked_objects = []
        for track_id, det_idx in matched_tracks:
            track = self.tracks[track_id]
            track.update(det_bboxes[det_idx].tolist(), det_scores[det_idx], self.frame_id)
            tracked_objects.append({
                'track_id': int(track_id),  # Ensure integer
                'bbox': [float(x) for x in track.bbox],  # Convert to float for JSON
                'score': float(track.score),  # Convert to float
                'frame_id': int(self.frame_id)  # Ensure integer
            })
        
        # Create new tracks for unmatched detections
        for det_idx in unmatched_dets:
            if det_scores[det_idx] > self.track_thresh:
                track_id = self.track_id_count
                self.track_id_count += 1
                
                track = Track(track_id, det_bboxes[det_idx].tolist(), det_scores[det_idx], self.frame_id)
                self.tracks[track_id] = track
                
                tracked_objects.append({
                    'track_id': int(track_id),  # Ensure integer
                    'bbox': [float(x) for x in track.bbox],  # Convert to float for JSON
                    'score': float(track.score),  # Convert to float
                    'frame_id': int(self.frame_id)  # Ensure integer
                })
        
        # Handle lost tracks
        self._handle_lost_tracks()
        
        return tracked_objects
    
    def _match_tracks(self, det_bboxes, det_scores):
        """Match detections with existing tracks using IoU"""
        if not self.tracks:
            return [], list(range(len(det_bboxes)))
        
        # Create cost matrix
        track_ids = list(self.tracks.keys())
        cost_matrix = np.zeros((len(track_ids), len(det_bboxes)))
        
        for i, track_id in enumerate(track_ids):
            track = self.tracks[track_id]
            # Use predicted position for matching
            predicted_bbox = track.predict(self.frame_id)
            
            for j, det_bbox in enumerate(det_bboxes):
                iou = self.compute_iou(predicted_bbox, det_bbox)
                cost_matrix[i, j] = 1 - iou  # Convert IoU to cost
        
        # Simple greedy matching
        matched_tracks = []
        unmatched_dets = list(range(len(det_bboxes)))
        
        for i, track_id in enumerate(track_ids):
            best_match = -1
            best_iou = 0
            
            for j in unmatched_dets:
                iou = 1 - cost_matrix[i, j]
                if iou > self.match_thresh and iou > best_iou:
                    best_match = j
                    best_iou = iou
            
            if best_match != -1:
                matched_tracks.append((track_id, best_match))
                unmatched_dets.remove(best_match)
        
        return matched_tracks, unmatched_dets
    
    def _handle_lost_tracks(self):
        """Handle tracks that haven't been updated recently"""
        tracks_to_remove = []
        
        for track_id, track in self.tracks.items():
            frames_since_update = self.frame_id - track.last_update
            if frames_since_update > self.max_time_lost:
                tracks_to_remove.append(track_id)
        
        for track_id in tracks_to_remove:
            if track_id not in self.removed_tracks:
                self.removed_tracks.add(track_id)
                del self.tracks[track_id]
    
    def compute_iou(self, bbox1, bbox2):
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
