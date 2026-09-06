'use client'

import { useCallback, useEffect, useRef } from 'react'
import { LiveAnalysisEngine, type LiveFrame } from './live-engine'
import { clearTrails, drawOverlay, recordTrails } from './overlay'
import { useSessionStore } from '@/lib/store'
import { DEFAULT_TEAM_COLORS } from '@/lib/analytics'

/**
 * Runs detection on the playing <video> and paints the overlay.
 *
 * Overlay drawing happens straight in the engine callback so boxes track the
 * players at full analysis rate; only the coalesced analytics update goes
 * through the store, which keeps React out of the per-frame path.
 */
export function useLiveAnalysis(
  videoRef: React.RefObject<HTMLVideoElement>,
  canvasRef: React.RefObject<HTMLCanvasElement>,
) {
  const liveEnabled = useSessionStore((state) => state.liveEnabled)
  const liveQuality = useSessionStore((state) => state.liveQuality)
  const videoUrl = useSessionStore((state) => state.videoUrl)
  const ingestLiveFrame = useSessionStore((state) => state.ingestLiveFrame)
  const setLiveStatus = useSessionStore((state) => state.setLiveStatus)
  const engineRef = useRef<LiveAnalysisEngine | null>(null)
  const lastFrameRef = useRef<LiveFrame | null>(null)
  const lastFrameAtRef = useRef(0)
  const repaintRef = useRef<number | null>(null)

  const paint = useCallback(
    (frame: LiveFrame, extrapolateMs: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      drawOverlay(
        canvas,
        frame,
        {
          showLabels: true,
          showTrails: true,
          teamColors: frame.team_colors || {
            team_a: DEFAULT_TEAM_COLORS.team_a,
            team_b: DEFAULT_TEAM_COLORS.team_b,
          },
        },
        extrapolateMs,
      )
    },
    [canvasRef],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return

    const engine = new LiveAnalysisEngine({
      quality: liveQuality,
      onStatus: setLiveStatus,
      onFrame: (frame) => {
        lastFrameRef.current = frame
        lastFrameAtRef.current = performance.now()
        recordTrails(frame)
        // Paint here as well as in the animation loop: requestAnimationFrame
        // does not fire in a background tab, and the overlay must never be
        // left blank just because the loop is suspended.
        paint(frame, 0)
        ingestLiveFrame(frame)
      },
    })
    engineRef.current = engine

    // Detection runs at a few hertz; repainting every animation frame and
    // advancing boxes along each track's motion vector is what makes the
    // overlay look like it is following the players rather than stepping.
    const repaint = () => {
      repaintRef.current = requestAnimationFrame(repaint)
      const frame = lastFrameRef.current
      if (!frame) return
      paint(frame, performance.now() - lastFrameAtRef.current)
    }
    repaintRef.current = requestAnimationFrame(repaint)

    return () => {
      if (repaintRef.current != null) cancelAnimationFrame(repaintRef.current)
      repaintRef.current = null
      engine.detach()
      engineRef.current = null
      clearTrails()
    }
    // The engine is created once per mount; quality changes go through setQuality.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  useEffect(() => {
    engineRef.current?.setQuality(liveQuality)
  }, [liveQuality])

  // Attach to the video element and follow its playback state.
  useEffect(() => {
    const engine = engineRef.current
    const video = videoRef.current
    if (!engine || !video || !videoUrl) return

    engine.attach(video)
    clearTrails()

    if (!liveEnabled) {
      engine.stop()
      return
    }

    // Loading the model means fetching weights and compiling WebGL shaders,
    // which blocks the main thread. Holding it until the clip is decodable
    // keeps it from landing on top of the browser's own video setup — on a
    // large file the two together can hang the tab long enough for the browser
    // to offer to kill the page.
    let preloadTimer: ReturnType<typeof setTimeout> | null = null
    const beginPreload = () => {
      if (preloadTimer) return
      preloadTimer = setTimeout(() => {
        preloadTimer = null
        void engine.preload()
      }, 150)
    }
    if (video.readyState >= 2) beginPreload()
    else video.addEventListener('canplay', beginPreload, { once: true })

    const onPlay = () => engine.start()
    const onPause = () => {
      engine.stop()
      void engine.analyzeCurrentFrame()
    }
    const onSeeked = () => {
      // A big jump lands on unrelated play, so identities cannot survive it.
      // A small scrub is continuous enough to keep them.
      if (engine.isDiscontinuous(video.currentTime)) {
        clearTrails()
        engine.reset()
      }
      if (video.paused) void engine.analyzeCurrentFrame()
    }
    const onLoaded = () => {
      engine.reset()
      clearTrails()
      void engine.analyzeCurrentFrame()
    }
    const onEnded = () => engine.stop()

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('loadeddata', onLoaded)
    video.addEventListener('ended', onEnded)
    if (!video.paused) engine.start()

    return () => {
      if (preloadTimer) clearTimeout(preloadTimer)
      video.removeEventListener('canplay', beginPreload)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('ended', onEnded)
      engine.stop()
    }
  }, [videoUrl, liveEnabled, videoRef])

  return engineRef
}
