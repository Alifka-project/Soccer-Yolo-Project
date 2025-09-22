import numpy as np
from typing import Dict, List
import cv2

class MetricsAnalyzer:
    def __init__(self, fps=30, pitch_dims=(105, 68)):
        """Initialize metrics analyzer"""
        self.fps = fps
        self.pitch_width, self.pitch_height = pitch_dims
        self.tracks = {}
        self.events = []
        
    def update_tracks(self, frame_tracks, frame_idx):
        """Update tracking data for metrics calculation"""
        for track in frame_tracks:
            track_id = track['track_id']
            if track_id not in self.tracks:
                self.tracks[track_id] = {
                    'positions': [],
                    'frames': [],
                    'team': None,
                    'jersey': None
                }
            
            self.tracks[track_id]['positions'].append(track['bbox'][:2])
            self.tracks[track_id]['frames'].append(frame_idx)
    
    def calculate_distance(self, track_id, start_frame=0, end_frame=-1):
        """Calculate total distance traveled by a track"""
        if track_id not in self.tracks:
            return 0
        
        positions = np.array(self.tracks[track_id]['positions'])
        if end_frame == -1:
            end_frame = len(positions)
        
        positions = positions[start_frame:end_frame]
        if len(positions) < 2:
            return 0
        
        # Calculate distances between consecutive positions
        diffs = np.diff(positions, axis=0)
        distances = np.sqrt(np.sum(diffs**2, axis=1))
        
        return np.sum(distances)
    
    def calculate_speed(self, track_id, window_size=10):
        """Calculate speed over time for a track"""
        if track_id not in self.tracks:
            return []
        
        positions = np.array(self.tracks[track_id]['positions'])
        if len(positions) < window_size:
            return []
        
        speeds = []
        for i in range(window_size, len(positions)):
            window_positions = positions[i-window_size:i]
            distance = self.calculate_distance_from_positions(window_positions)
            time_seconds = window_size / self.fps
            speed = distance / time_seconds if time_seconds > 0 else 0
            speeds.append(speed)
        
        return speeds
    
    def calculate_distance_from_positions(self, positions):
        """Helper to calculate distance from position array"""
        if len(positions) < 2:
            return 0
        diffs = np.diff(positions, axis=0)
        distances = np.sqrt(np.sum(diffs**2, axis=1))
        return np.sum(distances)
    
    def generate_heatmap(self, track_id, grid_size=(20, 15)):
        """Generate heatmap for a specific track"""
        if track_id not in self.tracks:
            return np.zeros(grid_size)
        
        positions = np.array(self.tracks[track_id]['positions'])
        heatmap = np.zeros(grid_size)
        
        # Normalize positions to grid
        for pos in positions:
            x_idx = int(pos[0] * grid_size[0] / self.pitch_width)
            y_idx = int(pos[1] * grid_size[1] / self.pitch_height)
            x_idx = min(x_idx, grid_size[0] - 1)
            y_idx = min(y_idx, grid_size[1] - 1)
            heatmap[y_idx, x_idx] += 1
        
        return heatmap
    
    def detect_events(self):
        """Detect game events (goals, sprints, etc.)"""
        events = []
        
        # Sprint detection
        for track_id in self.tracks:
            speeds = self.calculate_speed(track_id)
            for i, speed in enumerate(speeds):
                if speed > 7.0:  # Sprint threshold (m/s)
                    events.append({
                        'type': 'sprint',
                        'track_id': track_id,
                        'frame': i,
                        'speed': speed
                    })
        
        return events
    
    def calculate_team_metrics(self, team_tracks):
        """Calculate team-level metrics"""
        if not team_tracks:
            return {}
        
        # Calculate team width and height
        positions = []
        for track_id in team_tracks:
            if track_id in self.tracks:
                positions.extend(self.tracks[track_id]['positions'])
        
        if not positions:
            return {}
        
        positions = np.array(positions)
        width = np.max(positions[:, 0]) - np.min(positions[:, 0])
        height = np.max(positions[:, 1]) - np.min(positions[:, 1])
        
        return {
            'width': width,
            'height': height,
            'compactness': width * height,
            'centroid': np.mean(positions, axis=0).tolist()
        }
