'use client'

import { useRef, useEffect, useState } from 'react'
import { useSessionStore } from '@/lib/store'
import { WORKER_HTTP } from '@/lib/config'

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
    realtimeFrameUrl,
    backendMode,
  } = useSessionStore()
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [overlayImage, setOverlayImage] = useState<string | null>(null)

  useEffect(() => {
    if (videoRef.current && videoUrl) {
      setIsLoading(true)
      setHasError(false)
      videoRef.current.load()
    }
  }, [videoUrl])

  useEffect(() => {
    return () => {
      if (realtimeFrameUrl) {
        URL.revokeObjectURL(realtimeFrameUrl)
      }
    }
  }, [realtimeFrameUrl])

  useEffect(() => {
    if (backendMode === 'worker' && sessionId && processingStatus === 'completed' && currentFrame >= 0 && !isRealtimeMode) {
      setOverlayImage(`${WORKER_HTTP}/sessions/${sessionId}/frame/${currentFrame}`)
    } else {
      setOverlayImage(null)
    }
  }, [sessionId, processingStatus, currentFrame, isRealtimeMode, backendMode])

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const fps = 30
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

  const handleError = () => {
    setIsLoading(false)
    setHasError(true)
  }

  return (
    <div className="relative w-full h-full">
      {videoUrl && videoData ? (
        <>
          {isRealtimeMode && realtimeFrameUrl ? (
            <div className="w-full h-full">
              <img 
                src={realtimeFrameUrl} 
                alt="Real-time tracking"
                className="w-full h-full object-contain"
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
                onTimeUpdate={handleTimeUpdate}
                style={{ display: isRealtimeMode ? 'none' : 'block' }}
              >
                Your browser does not support the video tag.
              </video>
              
              {overlayImage && processingStatus === 'completed' && !isRealtimeMode && (
                <div className="absolute inset-0 pointer-events-none">
                  <img 
                    src={overlayImage} 
                    alt="Tracking overlay"
                    className="w-full h-full object-contain opacity-80"
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
                <div className="text-lg mb-2">Video Error</div>
                <div className="text-sm text-gray-300">Failed to load video</div>
              </div>
            </div>
          )}

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
