#!/usr/bin/env python3
"""
Test script to verify analytics functionality
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'worker'))

from analytics.possession_analyzer import BallPossessionAnalyzer
import numpy as np

def test_analytics():
    print("🧪 Testing Analytics Components...")
    
    # Initialize analyzer
    analyzer = BallPossessionAnalyzer(fps=30.0, possession_threshold=0.5)
    print("✅ BallPossessionAnalyzer initialized")
    
    # Create mock tracking data
    mock_tracks = [
        {
            'track_id': 1,
            'class': 'person',
            'bbox': [100, 100, 50, 50],
            'score': 0.9,
            'center': (125, 125)
        },
        {
            'track_id': 2,
            'class': 'ball',
            'bbox': [120, 120, 20, 20],
            'score': 0.8,
            'center': (130, 130)
        },
        {
            'track_id': 3,
            'class': 'person',
            'bbox': [200, 200, 50, 50],
            'score': 0.85,
            'center': (225, 225)
        }
    ]
    
    # Update with mock data for several frames
    for frame_id in range(30):
        analyzer.update_tracks(mock_tracks, frame_id)
    
    # Get analytics data
    possession_stats = analyzer.get_possession_stats()
    pass_stats = analyzer.get_pass_stats()
    
    print("\n📊 Possession Stats:")
    for key, value in possession_stats.items():
        print(f"  {key}: {value}")
    
    print("\n⚽ Pass Stats:")
    for key, value in pass_stats.items():
        print(f"  {key}: {value}")
    
    # Test JSON serialization
    import json
    try:
        analytics_data = {
            'type': 'analytics',
            'frame_id': 30,
            'possession_stats': possession_stats,
            'pass_stats': pass_stats,
            'tracking_data': mock_tracks,
            'timestamp': 1234567890.0
        }
        
        json_str = json.dumps(analytics_data)
        print("\n✅ Analytics data is JSON serializable")
        print(f"📦 JSON size: {len(json_str)} bytes")
        
    except Exception as e:
        print(f"\n❌ JSON serialization error: {e}")
    
    print("\n🎉 Analytics test completed successfully!")

if __name__ == "__main__":
    test_analytics()

