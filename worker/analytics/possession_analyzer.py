import numpy as np
from typing import List, Dict, Tuple, Optional
import cv2
from collections import defaultdict
import time

class BallPossessionAnalyzer:
    """Advanced ball possession analyzer inspired by Tryolabs approach"""
    
    def __init__(self, fps: float = 30.0, possession_threshold: float = 0.5, field_width: float = 1280.0):
        """
        Initialize ball possession analyzer
        
        Args:
            fps: Video frame rate
            possession_threshold: Minimum time (seconds) to consider possession
            field_width: Frame width in pixels, used for team split
        """
        self.fps = fps
        self.possession_threshold = possession_threshold
        self.frame_threshold = max(1, int(possession_threshold * fps))
        self.field_width = field_width or 1280.0
        
        # Tracking data
        self.ball_tracks = []
        self.player_tracks = []
        self.possession_events = []
        self.current_possession = None
        
        # Possession state
        self.possession_history = []
        self.team_possession_time = defaultdict(float)
        self.total_possession_time = 0.0
        
        # Pass detection
        self.pass_events = []
        self.pass_threshold_distance = 400  # pixels
        self.pass_threshold_frames = 20  # frames
        self._pass_keys = set()
        
    def update_tracks(self, tracked_objects: List[Dict], frame_id: int):
        """Update tracking data with new frame"""
        # Separate ball and player tracks
        ball_tracks = [obj for obj in tracked_objects if obj.get('class') == 'ball']
        player_tracks = [obj for obj in tracked_objects if obj.get('class') == 'person']
        
        # Update ball tracking
        if ball_tracks:
            # Take the ball with highest confidence
            best_ball = max(ball_tracks, key=lambda x: x['score'])
            self.ball_tracks.append({
                'frame_id': frame_id,
                'bbox': best_ball['bbox'],
                'center': self._get_center(best_ball['bbox']),
                'track_id': best_ball.get('track_id', -1),
                'confidence': best_ball['score']
            })
        
        # Update player tracking
        for player in player_tracks:
            self.player_tracks.append({
                'frame_id': frame_id,
                'bbox': player['bbox'],
                'center': self._get_center(player['bbox']),
                'track_id': player.get('track_id', -1),
                'confidence': player['score'],
                'team': player.get('team', 'unknown'),
            })

        keep_after = max(0, frame_id - int(self.fps * 8))
        self.player_tracks = [player for player in self.player_tracks if player['frame_id'] >= keep_after]
        self.ball_tracks = [ball for ball in self.ball_tracks if ball['frame_id'] >= max(0, frame_id - int(self.fps * 12))]
        
        # Analyze possession
        self._analyze_possession(frame_id)
        
        # Detect passes
        self._detect_passes(frame_id)
    
    def _get_center(self, bbox: List[float]) -> Tuple[float, float]:
        """Get center point of bounding box"""
        x, y, w, h = bbox
        return (x + w/2, y + h/2)
    
    def _analyze_possession(self, frame_id: int):
        """Analyze ball possession based on proximity to players"""
        if not self.ball_tracks or not self.player_tracks:
            return
        
        # Get current ball position
        current_ball = self.ball_tracks[-1]
        ball_center = current_ball['center']
        
        # Find closest player in current frame
        closest_player = None
        min_distance = float('inf')
        
        for player in self.player_tracks:
            if player['frame_id'] == frame_id:
                distance = self._calculate_distance(ball_center, player['center'])
                if distance < min_distance:
                    min_distance = distance
                    closest_player = player
        
        # Determine possession based on player size, not a fixed 80px radius
        player_size = max(closest_player['bbox'][2], closest_player['bbox'][3]) if closest_player else 80
        possession_distance_threshold = max(48.0, player_size * 1.6)

        if closest_player and min_distance < possession_distance_threshold:
            # Ball is close to a player - potential possession
            if (self.current_possession is None or 
                self.current_possession['player_id'] != closest_player['track_id']):
                
                # New possession or change of possession
                if self.current_possession:
                    # End previous possession
                    self._end_possession(frame_id)
                
                # Start new possession
                self._start_possession(closest_player, frame_id)
            else:
                # Continue current possession
                self._update_possession(frame_id)
        else:
            # Ball is not close to any player
            if self.current_possession:
                self._end_possession(frame_id)
    
    def _start_possession(self, player: Dict, frame_id: int):
        """Start a new possession"""
        self.current_possession = {
            'player_id': player['track_id'],
            'start_frame': frame_id,
            'end_frame': None,
            'duration': 0,
            'team': self._get_player_team(player['track_id']),
            'positions': [player['center']]
        }
    
    def _update_possession(self, frame_id: int):
        """Update current possession"""
        if self.current_possession:
            # Find current player position
            current_player_pos = None
            for player in self.player_tracks:
                if (player['frame_id'] == frame_id and 
                    player['track_id'] == self.current_possession['player_id']):
                    current_player_pos = player['center']
                    break
            
            if current_player_pos:
                self.current_possession['positions'].append(current_player_pos)
                self.current_possession['duration'] = frame_id - self.current_possession['start_frame']
    
    def _end_possession(self, frame_id: int):
        """End current possession"""
        if self.current_possession:
            self.current_possession['end_frame'] = frame_id
            self.current_possession['duration'] = frame_id - self.current_possession['start_frame']
            
            # Only record possession if it meets threshold
            if self.current_possession['duration'] >= self.frame_threshold:
                self.possession_events.append(self.current_possession.copy())
                
                # Update team possession time
                team = self.current_possession['team']
                possession_time = self.current_possession['duration'] / self.fps
                self.team_possession_time[team] += possession_time
                self.total_possession_time += possession_time
            
            self.current_possession = None
    
    def _get_player_team(self, player_id: int) -> str:
        """Use jersey-classified team when available, otherwise field split."""
        for player in reversed(self.player_tracks):
            if player['track_id'] == player_id and player.get('team') in ('team_a', 'team_b'):
                return player['team']

        player_positions = [p['center'] for p in self.player_tracks if p['track_id'] == player_id]
        if not player_positions:
            return 'unknown'

        avg_x = float(np.mean([pos[0] for pos in player_positions]))
        split = self.field_width / 2.0 if self.field_width else 640.0
        if avg_x < split:
            return 'team_a'
        return 'team_b'
    
    def _detect_passes(self, frame_id: int):
        """Detect passes between players"""
        if len(self.possession_events) < 2:
            return
        
        # Look for quick possession changes that might indicate passes
        recent_possessions = [p for p in self.possession_events 
                            if frame_id - p['end_frame'] < self.pass_threshold_frames]
        
        for i in range(len(recent_possessions) - 1):
            current_possession = recent_possessions[i]
            next_possession = recent_possessions[i + 1]
            
            # Check if possession changed quickly (potential pass)
            time_between = next_possession['start_frame'] - current_possession['end_frame']
            
            if time_between <= self.pass_threshold_frames:
                # Calculate distance between players
                end_pos = current_possession['positions'][-1]
                start_pos = next_possession['positions'][0]
                distance = self._calculate_distance(end_pos, start_pos)
                
                if distance <= self.pass_threshold_distance:
                    same_team = current_possession.get('team') == next_possession.get('team')
                    if not same_team:
                        continue
                    key = (
                        current_possession['player_id'],
                        next_possession['player_id'],
                        current_possession['end_frame'],
                    )
                    if key in self._pass_keys:
                        continue
                    self._pass_keys.add(key)
                    pass_event = {
                        'from_player': current_possession['player_id'],
                        'to_player': next_possession['player_id'],
                        'from_team': current_possession['team'],
                        'to_team': next_possession['team'],
                        'team': current_possession['team'],
                        'frame_id': current_possession['end_frame'],
                        'distance': distance,
                        'successful': True
                    }
                    self.pass_events.append(pass_event)
    
    def _calculate_distance(self, pos1: Tuple[float, float], pos2: Tuple[float, float]) -> float:
        """Calculate Euclidean distance between two points"""
        return np.sqrt((pos1[0] - pos2[0])**2 + (pos1[1] - pos2[1])**2)
    
    def get_possession_stats(self) -> Dict:
        """Get possession statistics"""
        # If we have real possession data, use it
        if self.total_possession_time >= 0.35:
            team_a_time = self.team_possession_time['team_a']
            team_b_time = self.team_possession_time['team_b']
            total = max(team_a_time + team_b_time, self.total_possession_time)
            
            return {
                'team_a_possession': team_a_time,
                'team_b_possession': team_b_time,
                'team_a_percentage': (team_a_time / total) * 100,
                'team_b_percentage': (team_b_time / total) * 100,
                'total_possession_time': self.total_possession_time,
                'possession_events': len(self.possession_events),
                'passes': len(self.pass_events),
                'current_possession': self.current_possession
            }
        
        # No synthetic fallbacks — empty stats mean the ball was not held long enough.
        return {
            'team_a_possession': float(self.team_possession_time['team_a']),
            'team_b_possession': float(self.team_possession_time['team_b']),
            'team_a_percentage': 0.0,
            'team_b_percentage': 0.0,
            'total_possession_time': float(self.total_possession_time),
            'possession_events': len(self.possession_events),
            'passes': len(self.pass_events),
            'current_possession': self.current_possession
        }
    
    def get_pass_stats(self) -> Dict:
        """Get pass statistics"""
        # If we have real pass data, use it
        if self.pass_events:
            successful_passes = sum(1 for p in self.pass_events if p['successful'])
            team_a_passes = sum(1 for p in self.pass_events if p['from_team'] == 'team_a')
            team_b_passes = sum(1 for p in self.pass_events if p['from_team'] == 'team_b')
            
            return {
                'total_passes': len(self.pass_events),
                'successful_passes': successful_passes,
                'pass_success_rate': (successful_passes / len(self.pass_events)) * 100,
                'team_a_passes': team_a_passes,
                'team_b_passes': team_b_passes,
                'recent_passes': self.pass_events[-10:] if len(self.pass_events) >= 10 else self.pass_events
            }
        
        return {
            'total_passes': 0,
            'successful_passes': 0,
            'pass_success_rate': 0.0,
            'team_a_passes': 0,
            'team_b_passes': 0,
            'recent_passes': []
        }
    
    def reset(self):
        """Reset analyzer state"""
        self.ball_tracks = []
        self.player_tracks = []
        self.possession_events = []
        self.current_possession = None
        self.possession_history = []
        self.team_possession_time = defaultdict(float)
        self.total_possession_time = 0.0
        self.pass_events = []
        self._pass_keys = set()

