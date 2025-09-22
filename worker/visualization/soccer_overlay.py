import cv2
import numpy as np
from typing import List, Dict, Tuple, Optional
import time

class SoccerOverlayRenderer:
    """Enhanced soccer overlay renderer matching Tryolabs style"""
    
    def __init__(self):
        """Initialize overlay renderer"""
        # Color schemes
        self.colors = {
            'ball': (0, 0, 255),        # Red for ball
            'person': (0, 255, 0),      # Green for players
            'team_a': (255, 0, 0),      # Blue for team A
            'team_b': (255, 255, 0),    # Cyan for team B
            'possession': (255, 0, 255), # Magenta for possession
            'pass': (0, 255, 255),      # Yellow for passes
            'text': (255, 255, 255),    # White for text
            'background': (0, 0, 0)     # Black for backgrounds
        }
        
        # Font settings
        self.font = cv2.FONT_HERSHEY_SIMPLEX
        self.font_scale = 0.6
        self.font_thickness = 2
        
        # Overlay settings
        self.show_trajectories = True
        self.show_possession = True
        self.show_passes = True
        self.show_stats = True
        
        # Trajectory settings
        self.trajectory_length = 30
        self.trajectory_thickness = 2
        
        # Possession visualization
        self.possession_overlay_alpha = 0.3
        self.possession_radius = 40
        
    def render_overlay(self, frame: np.ndarray, tracked_objects: List[Dict], 
                      possession_stats: Dict = None, pass_events: List[Dict] = None,
                      frame_id: int = 0) -> np.ndarray:
        """Render comprehensive soccer overlay"""
        overlay_frame = frame.copy()
        
        # Render trajectories first (behind other elements)
        if self.show_trajectories:
            overlay_frame = self._render_trajectories(overlay_frame, tracked_objects)
        
        # Render possession indicators
        if self.show_possession and possession_stats:
            overlay_frame = self._render_possession_overlay(overlay_frame, possession_stats)
        
        # Render pass indicators
        if self.show_passes and pass_events:
            overlay_frame = self._render_pass_overlay(overlay_frame, pass_events)
        
        # Render object bounding boxes and labels
        overlay_frame = self._render_objects(overlay_frame, tracked_objects)
        
        # Render statistics overlay
        if self.show_stats:
            overlay_frame = self._render_stats_overlay(overlay_frame, possession_stats, frame_id)
        
        return overlay_frame
    
    def _render_trajectories(self, frame: np.ndarray, tracked_objects: List[Dict]) -> np.ndarray:
        """Render object trajectories"""
        # Group objects by track_id to draw trajectories
        trajectories = {}
        
        for obj in tracked_objects:
            track_id = obj.get('track_id', -1)
            if track_id not in trajectories:
                trajectories[track_id] = []
            
            center = self._get_center(obj['bbox'])
            trajectories[track_id].append(center)
        
        # Draw trajectories
        for track_id, positions in trajectories.items():
            if len(positions) < 2:
                continue
            
            # Limit trajectory length
            if len(positions) > self.trajectory_length:
                positions = positions[-self.trajectory_length:]
            
            # Determine color based on object class
            obj_class = tracked_objects[0].get('class', 'person') if tracked_objects else 'person'
            color = self.colors.get(obj_class, self.colors['person'])
            
            # Draw trajectory lines
            for i in range(1, len(positions)):
                cv2.line(frame, 
                        (int(positions[i-1][0]), int(positions[i-1][1])),
                        (int(positions[i][0]), int(positions[i][1])),
                        color, self.trajectory_thickness)
        
        return frame
    
    def _render_possession_overlay(self, frame: np.ndarray, possession_stats: Dict) -> np.ndarray:
        """Render possession visualization"""
        if not possession_stats or not possession_stats.get('current_possession'):
            return frame
        
        current_possession = possession_stats['current_possession']
        
        # Find the player with current possession
        for obj in possession_stats.get('tracked_objects', []):
            if (obj.get('track_id') == current_possession['player_id'] and 
                obj.get('class') == 'person'):
                
                center = self._get_center(obj['bbox'])
                
                # Draw possession circle
                cv2.circle(frame, 
                          (int(center[0]), int(center[1])),
                          self.possession_radius,
                          self.colors['possession'], 
                          -1)
                
                # Draw possession text
                cv2.putText(frame, "POSSESSION", 
                           (int(center[0] - 50), int(center[1] + 60)),
                           self.font, self.font_scale, 
                           self.colors['text'], self.font_thickness)
                break
        
        return frame
    
    def _render_pass_overlay(self, frame: np.ndarray, pass_events: List[Dict]) -> np.ndarray:
        """Render pass visualization"""
        if not pass_events:
            return frame
        
        # Show recent passes
        recent_passes = pass_events[-5:] if len(pass_events) >= 5 else pass_events
        
        for pass_event in recent_passes:
            # Draw pass arrow (simplified)
            # In a real implementation, you'd draw arrows between players
            frame_id = pass_event.get('frame_id', 0)
            
            # Draw pass indicator
            cv2.putText(frame, f"PASS {pass_event['from_player']} -> {pass_event['to_player']}",
                       (10, 30 + len(recent_passes) * 20),
                       self.font, 0.5, self.colors['pass'], 1)
        
        return frame
    
    def _render_objects(self, frame: np.ndarray, tracked_objects: List[Dict]) -> np.ndarray:
        """Render object bounding boxes and labels"""
        for obj in tracked_objects:
            bbox = obj['bbox']
            x, y, w, h = bbox
            class_name = obj.get('class', 'unknown')
            track_id = obj.get('track_id', -1)
            confidence = obj.get('score', 0.0)
            
            # Determine color
            if class_name == 'ball':
                color = self.colors['ball']
            elif class_name == 'person':
                # Assign team colors based on position (simplified)
                center_x = x + w/2
                field_width = frame.shape[1]
                if center_x < field_width / 2:
                    color = self.colors['team_a']
                else:
                    color = self.colors['team_b']
            else:
                color = self.colors['person']
            
            # Draw bounding box
            cv2.rectangle(frame, 
                         (int(x), int(y)), 
                         (int(x + w), int(y + h)), 
                         color, 2)
            
            # Draw label
            label = f"{class_name.upper()}:{track_id} ({confidence:.2f})"
            label_size = cv2.getTextSize(label, self.font, self.font_scale, self.font_thickness)[0]
            
            # Draw label background
            cv2.rectangle(frame,
                         (int(x), int(y) - label_size[1] - 10),
                         (int(x) + label_size[0], int(y)),
                         self.colors['background'], -1)
            
            # Draw label text
            cv2.putText(frame, label,
                       (int(x), int(y) - 5),
                       self.font, self.font_scale,
                       self.colors['text'], self.font_thickness)
            
            # Draw center point
            center = self._get_center(bbox)
            cv2.circle(frame, 
                      (int(center[0]), int(center[1])), 
                      3, color, -1)
        
        return frame
    
    def _render_stats_overlay(self, frame: np.ndarray, possession_stats: Dict, frame_id: int) -> np.ndarray:
        """Render statistics overlay"""
        if not possession_stats:
            return frame
        
        # Create stats panel
        panel_height = 120
        panel_width = 300
        panel_x = 10
        panel_y = frame.shape[0] - panel_height - 10
        
        # Draw stats panel background
        overlay = frame.copy()
        cv2.rectangle(overlay, 
                     (panel_x, panel_y), 
                     (panel_x + panel_width, panel_y + panel_height),
                     self.colors['background'], -1)
        
        # Add transparency
        cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)
        
        # Draw stats text
        y_offset = panel_y + 20
        
        # Frame info
        cv2.putText(frame, f"Frame: {frame_id}",
                   (panel_x + 10, y_offset),
                   self.font, self.font_scale,
                   self.colors['text'], self.font_thickness)
        y_offset += 20
        
        # Possession stats
        if 'team_a_percentage' in possession_stats:
            cv2.putText(frame, f"Team A: {possession_stats['team_a_percentage']:.1f}%",
                       (panel_x + 10, y_offset),
                       self.font, self.font_scale,
                       self.colors['team_a'], self.font_thickness)
            y_offset += 20
            
            cv2.putText(frame, f"Team B: {possession_stats['team_b_percentage']:.1f}%",
                       (panel_x + 10, y_offset),
                       self.font, self.font_scale,
                       self.colors['team_b'], self.font_thickness)
            y_offset += 20
        
        # Pass stats
        if 'passes' in possession_stats:
            cv2.putText(frame, f"Passes: {possession_stats['passes']}",
                       (panel_x + 10, y_offset),
                       self.font, self.font_scale,
                       self.colors['pass'], self.font_thickness)
        
        return frame
    
    def _get_center(self, bbox: List[float]) -> Tuple[float, float]:
        """Get center point of bounding box"""
        x, y, w, h = bbox
        return (x + w/2, y + h/2)
    
    def set_overlay_settings(self, show_trajectories: bool = True, 
                           show_possession: bool = True,
                           show_passes: bool = True,
                           show_stats: bool = True):
        """Update overlay display settings"""
        self.show_trajectories = show_trajectories
        self.show_possession = show_possession
        self.show_passes = show_passes
        self.show_stats = show_stats
    
    def update_colors(self, color_scheme: Dict[str, Tuple[int, int, int]]):
        """Update color scheme"""
        self.colors.update(color_scheme)

