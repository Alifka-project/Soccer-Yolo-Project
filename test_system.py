#!/usr/bin/env python3
"""
Test script to verify the enhanced soccer tracking system
Tests all components to ensure smooth operation like the reference video
"""

import requests
import json
import time
import sys
import os

def test_backend_connection():
    """Test if backend server is running and responsive"""
    print("🔍 Testing backend connection...")
    try:
        response = requests.get("http://localhost:8000/docs", timeout=5)
        if response.status_code == 200:
            print("✅ Backend server is running on port 8000")
            return True
        else:
            print(f"❌ Backend responded with status {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"❌ Backend connection failed: {e}")
        return False

def test_session_creation():
    """Test session creation endpoint"""
    print("\n🔍 Testing session creation...")
    try:
        response = requests.post("http://localhost:8000/sessions", timeout=10)
        if response.status_code == 200:
            data = response.json()
            session_id = data.get('sessionId')
            print(f"✅ Session created successfully: {session_id[:8]}...")
            return session_id
        else:
            print(f"❌ Session creation failed: {response.status_code}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"❌ Session creation error: {e}")
        return None

def test_imports():
    """Test if all new components can be imported"""
    print("\n🔍 Testing component imports...")
    
    try:
        # Add worker directory to Python path
        import sys
        worker_path = "/Users/Alifka_Roosseo/Desktop/Project/soccer-tracker/soccer-tracking-dashboard/worker"
        if worker_path not in sys.path:
            sys.path.insert(0, worker_path)
        
        # Test analytics import
        from analytics.possession_analyzer import BallPossessionAnalyzer
        print("✅ BallPossessionAnalyzer imported successfully")
        
        # Test soccer detector import
        from tracking.soccer_detector import EnhancedSoccerDetector, SoccerBallDetector
        print("✅ EnhancedSoccerDetector imported successfully")
        
        # Test overlay renderer import
        from visualization.soccer_overlay import SoccerOverlayRenderer
        print("✅ SoccerOverlayRenderer imported successfully")
        
        return True
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return False

def test_component_initialization():
    """Test if components can be initialized without errors"""
    print("\n🔍 Testing component initialization...")
    
    try:
        # Add worker directory to Python path
        import sys
        worker_path = "/Users/Alifka_Roosseo/Desktop/Project/soccer-tracker/soccer-tracking-dashboard/worker"
        if worker_path not in sys.path:
            sys.path.insert(0, worker_path)
        
        from analytics.possession_analyzer import BallPossessionAnalyzer
        from tracking.soccer_detector import EnhancedSoccerDetector
        from visualization.soccer_overlay import SoccerOverlayRenderer
        
        # Test possession analyzer
        analyzer = BallPossessionAnalyzer(fps=30.0, possession_threshold=0.5)
        print("✅ BallPossessionAnalyzer initialized")
        
        # Test soccer detector
        detector = EnhancedSoccerDetector(model_name="yolo11s", conf_thresh=0.3)
        print("✅ EnhancedSoccerDetector initialized")
        
        # Test overlay renderer
        renderer = SoccerOverlayRenderer()
        print("✅ SoccerOverlayRenderer initialized")
        
        return True
    except Exception as e:
        print(f"❌ Component initialization error: {e}")
        return False

def test_analytics_functionality():
    """Test analytics functionality with mock data"""
    print("\n🔍 Testing analytics functionality...")
    
    try:
        # Add worker directory to Python path
        import sys
        worker_path = "/Users/Alifka_Roosseo/Desktop/Project/soccer-tracker/soccer-tracking-dashboard/worker"
        if worker_path not in sys.path:
            sys.path.insert(0, worker_path)
        
        from analytics.possession_analyzer import BallPossessionAnalyzer
        
        analyzer = BallPossessionAnalyzer(fps=30.0, possession_threshold=0.5)
        
        # Mock tracking data
        mock_tracks = [
            {'track_id': 1, 'bbox': [100, 100, 50, 80], 'class': 'person', 'score': 0.9},
            {'track_id': 2, 'bbox': [200, 200, 20, 20], 'class': 'ball', 'score': 0.8},
            {'track_id': 3, 'bbox': [150, 150, 50, 80], 'class': 'person', 'score': 0.85}
        ]
        
        # Update tracks
        analyzer.update_tracks(mock_tracks, 1)
        analyzer.update_tracks(mock_tracks, 2)
        analyzer.update_tracks(mock_tracks, 3)
        
        # Get stats
        possession_stats = analyzer.get_possession_stats()
        pass_stats = analyzer.get_pass_stats()
        
        print(f"✅ Possession stats: Team A: {possession_stats['team_a_percentage']:.1f}%, Team B: {possession_stats['team_b_percentage']:.1f}%")
        print(f"✅ Pass stats: {pass_stats['total_passes']} total passes, {pass_stats['pass_success_rate']:.1f}% success rate")
        
        return True
    except Exception as e:
        print(f"❌ Analytics functionality error: {e}")
        return False

def test_frontend_connection():
    """Test if frontend can connect to backend"""
    print("\n🔍 Testing frontend-backend connection...")
    
    try:
        # Test if frontend is running
        response = requests.get("http://localhost:3002", timeout=5)
        if response.status_code == 200:
            print("✅ Frontend is running on port 3002")
            return True
        else:
            print(f"❌ Frontend responded with status {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"❌ Frontend connection failed: {e}")
        return False

def main():
    """Run all tests"""
    print("🚀 Starting Enhanced Soccer Tracking System Tests")
    print("=" * 60)
    
    tests_passed = 0
    total_tests = 6
    
    # Test 1: Backend connection
    if test_backend_connection():
        tests_passed += 1
    
    # Test 2: Session creation
    session_id = test_session_creation()
    if session_id:
        tests_passed += 1
    
    # Test 3: Component imports
    if test_imports():
        tests_passed += 1
    
    # Test 4: Component initialization
    if test_component_initialization():
        tests_passed += 1
    
    # Test 5: Analytics functionality
    if test_analytics_functionality():
        tests_passed += 1
    
    # Test 6: Frontend connection
    if test_frontend_connection():
        tests_passed += 1
    
    print("\n" + "=" * 60)
    print(f"📊 Test Results: {tests_passed}/{total_tests} tests passed")
    
    if tests_passed == total_tests:
        print("🎉 All tests passed! System is ready for soccer tracking!")
        print("\n📋 Next Steps:")
        print("1. Open http://localhost:3002 in your browser")
        print("2. Upload a soccer video (MP4, AVI, MOV)")
        print("3. Click 'Start Real-time Tracking'")
        print("4. Watch the live analytics and smooth tracking!")
        print("\n✨ Features you'll see:")
        print("• Real-time ball possession tracking")
        print("• Pass detection and counting")
        print("• Professional visual overlays")
        print("• Live statistics dashboard")
        print("• Smooth 30fps tracking")
    else:
        print("❌ Some tests failed. Please check the errors above.")
        return False
    
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
