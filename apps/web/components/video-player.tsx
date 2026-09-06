'use client'

import { useRef, useEffect, useState } from 'react'
import { useSessionStore } from '@/lib/store'
import { WORKER_HTTP } from '@/lib/config'
import { useLiveAnalysis } from '@/lib/vision/use-live-analysis'

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
    liveEnabled,
    liveStatus,
    videoFps,
    setVideoDuration,
  } = useSessionStore()
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [loadStalled, setLoadStalled] = useState(false)
  const [overlayImage, setOverlayImage] = useState<string | null>(null)

  useLiveAnalysis(videoRef, canvasRef)

  useEffect(() => {
    const handler = (event: Event) => {
      const time = (event as CustomEvent<number>).detail
      const video = videoRef.current
      if (video && Number.isFinite(time)) video.currentTime = Math.max(0, time)
    }
    window.addEventListener('seekToTime', handler)
    return () => window.removeEventListener('seekToTime', handler)
  }, [])

  useEffect(() => {
    if (!videoRef.current || !videoUrl) return
    setIsLoading(true)
    setHasError(false)
    setLoadStalled(false)
    videoRef.current.load()
    // A codec the browser cannot decode leaves the element loading forever with
    // no error event. Say so rather than spinning indefinitely.
    const stallTimer = setTimeout(() => {
      if (videoRef.current && videoRef.current.readyState < 2) setLoadStalled(true)
    }, 20000)
    return () => clearTimeout(stallTimer)
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
    // While live analysis runs it owns the frame cursor, since it knows the
    // real frame rate rather than assuming one.
    if (videoRef.current && !liveEnabled) {
      setCurrentFrame(Math.floor(videoRef.current.currentTime * (videoFps || 30)))
    }
  }

  const showCanvas = liveEnabled && !isRealtimeMode && !overlayImage
  const modelLoading = liveStatus?.state === 'loading'
  const modelError = liveStatus?.state === 'error' ? liveStatus.message : ''

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
                playsInline
                muted
                crossOrigin="anonymous"
                onLoadStart={() => { setIsLoading(true); setHasError(false) }}
                onCanPlay={() => { setIsLoading(false); setHasError(false); setLoadStalled(false) }}
                onLoadedMetadata={(event) => setVideoDuration(event.currentTarget.duration)}
                onError={() => { setIsLoading(false); setHasError(true) }}
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
            <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center p-6">
              <div className="max-w-md text-center text-white">
                {loadStalled ? (
                  <>
                    <div className="mb-2 text-lg">This clip is not decoding</div>
                    <div className="text-sm text-gray-300">
                      The browser has not been able to decode {videoData?.name || 'this file'} after 20 seconds.
                      That usually means an unsupported codec (for example HEVC in a .mov).
                      Convert it to H.264 MP4 and try again:
                    </div>
                    <code className="mt-2 block rounded bg-black/60 p-2 text-left text-[11px] text-gray-200">
                      ffmpeg -i input.mov -c:v libx264 -pix_fmt yuv420p output.mp4
                    </code>
                  </>
                ) : (
                  <>
                    <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-white"></div>
                    <div className="text-sm">Loading video…</div>
                  </>
                )}
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

          {showCanvas && (modelLoading || modelError) && (
            <div className="absolute top-4 left-4 rounded-md bg-black/70 px-3 py-2 text-xs text-white">
              {modelError ? (
                <span className="text-red-300">Detector failed: {modelError}</span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  Loading vision model…
                </span>
              )}
            </div>
          )}

          {showCanvas && liveStatus?.state === 'ready' && (
            <div className="absolute top-4 right-4 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
              <span className={`h-2 w-2 rounded-full ${liveStatus.running ? 'animate-pulse bg-emerald-400' : 'bg-gray-400'}`} />
              {liveStatus.running ? 'ANALYZING' : 'PAUSED'}
              <span className="text-gray-300">
                {liveStatus.detectedPlayers} players · {liveStatus.analysisFps.toFixed(1)} fps
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full bg-black flex items-center justify-center text-white">
          <div className="text-center">
            <div className="text-lg mb-2">No video loaded</div>
            <div className="text-sm text-gray-400">Upload a video — analysis starts as soon as it plays</div>
          </div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full pointer-events-none"
        style={{ display: showCanvas ? 'block' : 'none' }}
      />
    </div>
  )
}
