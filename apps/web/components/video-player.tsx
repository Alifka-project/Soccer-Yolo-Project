'use client'

import { useRef, useEffect, useState } from 'react'
import { useSessionStore } from '@/lib/store'

export function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { 
    videoUrl, 
    videoData, 
    sessionId, 
    processingStatus, 
    currentFrame, 
    setCurrentFrame,
    isRealtimeMode,
    realtimeFrameUrl
  } = useSessionStore()
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [overlayImage, setOverlayImage] = useState<string | null>(null)

  useEffect(() => {
    if (videoRef.current && videoUrl) {
      console.log('VideoPlayer: Loading video URL:', videoUrl)
      setIsLoading(true)
      setHasError(false)
      videoRef.current.load()
    }
  }, [videoUrl])

  // Clean up frame URLs when component unmounts
  useEffect(() => {
    return () => {
      if (realtimeFrameUrl) {
        URL.revokeObjectURL(realtimeFrameUrl)
      }
    }
  }, [realtimeFrameUrl])

  // Update overlay when frame changes (for batch processing)
  useEffect(() => {
    if (sessionId && processingStatus === 'completed' && currentFrame >= 0 && !isRealtimeMode) {
      const overlayUrl = `http://localhost:8000/sessions/${sessionId}/frame/${currentFrame}`
      setOverlayImage(overlayUrl)
    } else {
      setOverlayImage(null)
    }
  }, [sessionId, processingStatus, currentFrame, isRealtimeMode])

  // Update current frame when video time changes
  const handleTimeUpdate = () => {
    if (videoRef.current && videoData) {
      const fps = 30 // Assume 30 FPS for now
      const frame = Math.floor(videoRef.current.currentTime * fps)
      setCurrentFrame(frame)
    }
  }

  const handleLoadStart = () => {
    setIsLoading(true)
    setHasError(false)
  }

  const handleCanPlay = () => {
    setIsLoading(false)
    setHasError(false)
  }

  const handleError = (e: any) => {
    setIsLoading(false)
    setHasError(true)
    console.error('Video loading error:', videoUrl)
    console.error('Video error details:', e)
    console.error('Video element error:', videoRef.current?.error)
    
    // Clear the video URL to prevent infinite retries
    if (videoRef.current) {
      videoRef.current.src = ''
    }
  }

  return (
    <div className="relative w-full h-full">
      {videoUrl && videoData ? (
        <>
          {/* Real-time tracking display */}
          {isRealtimeMode && realtimeFrameUrl ? (
            <div className="w-full h-full">
              <img 
                src={realtimeFrameUrl} 
                alt="Real-time tracking"
                className="w-full h-full object-contain"
                style={{ imageRendering: 'auto' }}
              />
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-contain"
                controls={!isRealtimeMode}
                src={videoUrl}
                preload="metadata"
                onLoadStart={handleLoadStart}
                onCanPlay={handleCanPlay}
                onError={handleError}
                onLoadedData={() => console.log('Video data loaded')}
                onLoadedMetadata={() => console.log('Video metadata loaded')}
                onLoad={() => console.log('Video load event')}
                onProgress={() => console.log('Video progress')}
                onTimeUpdate={handleTimeUpdate}
                style={{ display: isRealtimeMode ? 'none' : 'block' }}
              >
                Your browser does not support the video tag.
              </video>
              
              {/* Tracking Overlay for batch processing */}
              {overlayImage && processingStatus === 'completed' && !isRealtimeMode && (
                <div className="absolute inset-0 pointer-events-none">
                  <img 
                    src={overlayImage} 
                    alt="Tracking overlay"
                    className="w-full h-full object-contain opacity-80"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </div>
              )}
            </>
          )}
          
          {isLoading && !isRealtimeMode && (
            <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
              <div className="text-white text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                <div className="text-sm">Loading video...</div>
              </div>
            </div>
          )}
          
          {hasError && !isRealtimeMode && (
            <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
              <div className="text-white text-center">
                <div className="text-lg mb-2">⚠️ Video Error</div>
                <div className="text-sm text-gray-300">Failed to load video</div>
                <div className="text-xs text-gray-400 mt-1">Check console for details</div>
              </div>
            </div>
          )}

          {/* Real-time status indicator */}
          {isRealtimeMode && (
            <div className="absolute top-4 right-4 bg-green-500 text-white px-3 py-1 rounded-full text-sm font-medium">
              LIVE TRACKING
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full bg-black flex items-center justify-center text-white">
          <div className="text-center">
            <div className="text-lg mb-2">No video loaded</div>
            <div className="text-sm text-gray-400">Upload a video to start tracking</div>
          </div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full pointer-events-none"
      />
    </div>
  )
}
