import { create } from 'zustand'
import { BackendMode, WORKER_HTTP, hasWorkerConfig, workerHttpUrl, workerWsUrl } from './config'
import { enrichTrackMap, mergeRealtimeTracks } from './analytics'
import type { LiveFrame, LiveStatus } from './vision/live-engine'
import type { DetectorQuality } from './vision/detector'

interface PossessionStats {
  team_a_possession: number
  team_b_possession: number
  team_a_percentage: number
  team_b_percentage: number
  total_possession_time: number
  possession_events: number
  passes: number
  current_possession: any
}

interface PassStats {
  total_passes: number
  successful_passes: number
  pass_success_rate: number
  team_a_passes: number
  team_b_passes: number
  recent_passes: any[]
}

interface AnalyticsData {
  frame_id: number
  possession_stats: PossessionStats
  pass_stats: PassStats
  tracking_data: any[]
  timestamp: number
  team_colors?: { team_a: string; team_b: string }
}

interface WorkerInfo {
  model_family?: string
  model_preview?: string
  model_publish?: string
  device?: string
}

interface SessionState {
  sessionId: string | null
  ttl: number
  videoData: any
  videoUrl: string | null
  tracks: Map<string, any>
  calibration: any
  jobId: string | null
  wsConnection: WebSocket | EventSource | null
  realtimeConnection: WebSocket | null
  processingStatus: 'idle' | 'processing' | 'completed' | 'error' | 'realtime' | 'live'
  progress: number
  error: string | null
  currentFrame: number
  totalFrames: number
  isRealtimeMode: boolean
  realtimeFrameUrl: string | null
  analyticsData: AnalyticsData | null
  backendMode: BackendMode
  workerInfo: WorkerInfo | null
  videoReady: boolean
  isUploading: boolean
  videoFps: number
  frameStride: number
  /** Held locally so the worker upload can wait until a worker job is actually run. */
  pendingFile: File | null
  workerVideoReady: boolean
  liveEnabled: boolean
  liveStatus: LiveStatus | null
  liveQuality: DetectorQuality
  liveFrameCount: number
  videoDuration: number

  createSession: () => Promise<void>
  uploadVideo: (file: File) => Promise<void>
  loadVideoFromUrl: (url: string) => Promise<void>
  ensureWorkerUpload: () => Promise<boolean>
  startTracking: (mode: string) => Promise<void>
  startRealtimeTracking: () => Promise<void>
  stopRealtimeTracking: () => void
  connectWebSocket: () => void
  connectRealtimeWebSocket: () => void
  reset: () => void
  setCurrentFrame: (frame: number) => void
  setVideoDuration: (seconds: number) => void
  setLiveEnabled: (enabled: boolean) => void
  setLiveQuality: (quality: DetectorQuality) => void
  setLiveStatus: (status: LiveStatus) => void
  ingestLiveFrame: (frame: LiveFrame) => void
  resetLive: () => void
}

function newSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `session-${Date.now()}`
}

function publishAnalytics(analytics: AnalyticsData | null) {
  if (!analytics || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('analyticsUpdate', { detail: analytics }))
}

function applyCompletedSummary(summary: any, fallbackFps: number) {
  const trackEntries = summary?.tracks || {}
  const tracks = enrichTrackMap(new Map(Object.entries(trackEntries)))
  const trackingData = Array.from(tracks.values()).map((t: any) => {
    const positions = t.positions || []
    const last = positions[positions.length - 1]
    return {
      track_id: t.id,
      bbox: last ? [last.x, last.y, last.w, last.h] : [0, 0, 0, 0],
      class: t.class || 'person',
      confidence: last?.score || 0,
      center: last ? [last.x + last.w / 2, last.y + last.h / 2] : [0, 0],
      team: t.team,
      color: t.color,
    }
  })
  const analytics = {
    frame_id: summary?.total_frames || 0,
    possession_stats: summary?.possession_stats || null,
    pass_stats: summary?.pass_stats || null,
    win_probability: summary?.win_probability || null,
    tracking_data: trackingData,
    timestamp: Date.now() / 1000,
    team_colors: summary?.team_colors,
  }
  return {
    tracks,
    analytics,
    totalFrames: summary?.total_frames || 0,
    videoFps: Number(summary?.fps) || fallbackFps,
    frameStride: Number(summary?.frame_stride) || 1,
  }
}

function jobErrorMessage(status: number, body: any) {
  const detail = body?.detail
  if (typeof detail === 'string' && detail) return detail
  return `HTTP error! status: ${status}`
}

let jobPollTimer: ReturnType<typeof setInterval> | null = null
let lastRealtimeAnalyticsAt = 0

/**
 * The in-browser engine emits ~10 frames/second. Re-deriving every analytics
 * panel that often burns more time than the inference does, so state updates
 * are coalesced here and the video overlay is drawn straight from the engine
 * callback instead.
 */
const LIVE_FLUSH_MS = 260
let pendingLiveFrame: LiveFrame | null = null
let liveFlushTimer: ReturnType<typeof setTimeout> | null = null

function stopJobPoll() {
  if (jobPollTimer) {
    clearInterval(jobPollTimer)
    jobPollTimer = null
  }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionId: null,
  ttl: 1800,
  videoData: null,
  videoUrl: null,
  tracks: new Map(),
  calibration: null,
  jobId: null,
  wsConnection: null,
  realtimeConnection: null,
  processingStatus: 'idle',
  progress: 0,
  error: null,
  currentFrame: 0,
  totalFrames: 0,
  isRealtimeMode: false,
  realtimeFrameUrl: null,
  analyticsData: null,
  backendMode: hasWorkerConfig() ? 'worker' : 'demo',
  workerInfo: null,
  videoReady: false,
  isUploading: false,
  videoFps: 30,
  frameStride: 1,
  pendingFile: null,
  workerVideoReady: false,
  liveEnabled: true,
  liveStatus: null,
  liveQuality: 'balanced',
  liveFrameCount: 0,
  videoDuration: 0,

  createSession: async () => {
    const fallbackId = newSessionId()

    if (!hasWorkerConfig()) {
      set({
        sessionId: fallbackId,
        ttl: 1800,
        backendMode: 'demo',
        workerInfo: null,
        error: null,
        processingStatus: 'idle',
      })
      return
    }

    try {
      const healthRes = await fetch(workerHttpUrl('/health'), { cache: 'no-store' })
      if (!healthRes.ok) {
        throw new Error(`Worker health check failed (${healthRes.status})`)
      }
      const workerInfo = await healthRes.json()

      const res = await fetch(workerHttpUrl('/sessions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        throw new Error(`Session creation failed: ${res.status}`)
      }
      const data = await res.json()
      set({
        sessionId: data.sessionId,
        ttl: data.ttlSeconds || 1800,
        backendMode: 'worker',
        workerInfo,
        error: null,
        processingStatus: 'idle',
      })
    } catch (error) {
      console.warn('Worker unavailable; running browser-only live analysis', error)
      set({
        sessionId: fallbackId,
        ttl: 1800,
        backendMode: 'demo',
        workerInfo: null,
        error: null,
        processingStatus: 'idle',
      })
    }
  },

  uploadVideo: async (file: File) => {
    const { sessionId, videoUrl: previousUrl } = get()
    if (!sessionId) {
      set({
        error: 'No session available. Please refresh the page.',
        processingStatus: 'error',
      })
      return
    }

    if (previousUrl) {
      URL.revokeObjectURL(previousUrl)
    }

    // Nothing is sent anywhere here. Dropping a file used to kick off a
    // full upload to the worker at the same moment the browser began decoding
    // the clip and the vision model began compiling shaders; on a large file
    // those three together could starve the main thread badly enough for the
    // browser to offer to kill the page. Live analysis never needs the upload,
    // so it now waits until a worker job actually asks for it.
    const localUrl = URL.createObjectURL(file)
    set({
      videoData: {
        name: file.name,
        size: file.size,
        type: file.type,
      },
      videoUrl: localUrl,
      pendingFile: file,
      processingStatus: 'idle',
      error: null,
      tracks: new Map(),
      analyticsData: null,
      progress: 0,
      videoReady: true,
      workerVideoReady: false,
      isUploading: false,
      liveFrameCount: 0,
    })
    get().resetLive()
  },

  /** Sends the held clip to the worker, once, when a worker job needs it. */
  ensureWorkerUpload: async () => {
    const { sessionId, pendingFile, workerVideoReady, backendMode } = get()
    if (backendMode !== 'worker') return false
    if (workerVideoReady) return true
    if (!sessionId || !pendingFile) {
      set({ error: 'No video available to send to the worker.' })
      return false
    }

    set({ isUploading: true, error: null })
    try {
      const formData = new FormData()
      formData.append('file', pendingFile)
      const res = await fetch(workerHttpUrl(`/sessions/${sessionId}/upload`), {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`Upload failed: ${res.status} ${res.statusText} - ${errorText}`)
      }
      const uploaded = await res.json().catch(() => ({}))
      set({
        isUploading: false,
        workerVideoReady: true,
        error: null,
        videoFps: Number(uploaded.fps) || get().videoFps,
        totalFrames: Number(uploaded.frameCount) || get().totalFrames,
      })
      return true
    } catch (error) {
      console.error('Video upload error:', error)
      set({
        error: `Worker upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isUploading: false,
        workerVideoReady: false,
      })
      return false
    }
  },

  /**
   * Loads a clip from a URL (same-origin, or a host that sends CORS headers).
   *
   * A cross-origin video without CORS headers taints the canvas and blocks the
   * pixel reads that team classification depends on, so the fetch happens here
   * and the clip is handed on as a local blob.
   */
  loadVideoFromUrl: async (url: string) => {
    try {
      set({ error: null, isUploading: true })
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const name = url.split('/').pop() || 'clip.mp4'
      const file = new File([blob], name, { type: blob.type || 'video/mp4' })
      await get().uploadVideo(file)
    } catch (error) {
      set({
        isUploading: false,
        error: `Could not load video from URL: ${error instanceof Error ? error.message : 'unknown error'}`,
      })
    }
  },

  startTracking: async (mode: string) => {
    const { sessionId, videoData, backendMode, videoReady, isUploading } = get()
    if (!sessionId) return
    if (!videoData) {
      set({
        error: 'No video uploaded. Please upload a video first.',
        processingStatus: 'error',
      })
      return
    }
    if (backendMode === 'worker' && isUploading) {
      set({ error: 'The clip is still uploading to the worker.', processingStatus: 'error' })
      return
    }
    if (backendMode === 'worker' && !(await get().ensureWorkerUpload())) {
      set({ processingStatus: 'error' })
      return
    }

    try {
      stopJobPoll()
      get().resetLive()
      set({ processingStatus: 'processing', progress: 0, error: null })

      if (backendMode !== 'worker') {
        set({
          processingStatus: 'idle',
          progress: 0,
          error: 'Batch tracking needs the YOLO26 worker. Live browser analysis is already running — just press play.',
        })
        return
      }

      const res = await fetch(workerHttpUrl(`/sessions/${sessionId}/jobs`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, tracker: 'bytetrack' }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(jobErrorMessage(res.status, body))
      }
      set({ jobId: body.jobId })
      get().connectWebSocket()

      jobPollTimer = setInterval(async () => {
        const { sessionId: sid, jobId, processingStatus } = get()
        if (!sid || !jobId || processingStatus !== 'processing') {
          stopJobPoll()
          return
        }
        try {
          const statusRes = await fetch(workerHttpUrl(`/sessions/${sid}/jobs/${jobId}`))
          if (!statusRes.ok) return
          const status = await statusRes.json()
          if (typeof status.progressPct === 'number') {
            set({
              progress: status.progressPct,
              currentFrame: status.currentFrame || get().currentFrame,
              totalFrames: status.totalFrames || get().totalFrames,
            })
          }
          if (status.status === 'done') {
            stopJobPoll()
            const completed = applyCompletedSummary(status.summary, get().videoFps)
            set({
              processingStatus: 'completed',
              progress: 100,
              tracks: completed.tracks,
              totalFrames: completed.totalFrames || status.totalFrames || 0,
              analyticsData: completed.analytics,
              videoFps: completed.videoFps,
              frameStride: completed.frameStride,
              wsConnection: null,
            })
            publishAnalytics(completed.analytics)
            return
          }
          if (status.status === 'error') {
            stopJobPoll()
            set({
              processingStatus: 'error',
              error: status.error || 'Processing error occurred',
            })
          }
        } catch (pollError) {
          console.warn('Job status poll failed', pollError)
        }
      }, 1000)
    } catch (error) {
      console.error('Error starting tracking:', error)
      stopJobPoll()
      set({
        processingStatus: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  },

  connectWebSocket: () => {
    const { sessionId, jobId, backendMode } = get()
    if (!sessionId || !jobId) return

    if (backendMode === 'worker') {
      const socket = new WebSocket(workerWsUrl(`/sessions/${sessionId}/stream?jobId=${jobId}`))

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'PROGRESS') {
            set({
              progress: data.pct,
              currentFrame: data.current_frame || get().currentFrame,
              totalFrames: data.total_frames || get().totalFrames,
            })
            return
          }
          if (data.type === 'DONE') {
            stopJobPoll()
            const completed = applyCompletedSummary(data.summary, get().videoFps)
            set({
              processingStatus: 'completed',
              progress: 100,
              tracks: completed.tracks,
              totalFrames: completed.totalFrames,
              analyticsData: completed.analytics,
              videoFps: completed.videoFps,
              frameStride: completed.frameStride,
              wsConnection: null,
            })
            publishAnalytics(completed.analytics)
            socket.close()
            return
          }
          if (data.type === 'ERROR') {
            stopJobPoll()
            set({
              processingStatus: 'error',
              error: data.message || 'Processing error occurred',
            })
            socket.close()
          }
        } catch (error) {
          console.error('Error parsing worker message:', error)
        }
      }

      socket.onerror = () => {
        console.warn('Worker WebSocket error; HTTP polling will keep progress updated.')
      }

      set({ wsConnection: socket })
      return
    }

    // Without a worker there is nothing to stream: the browser pipeline is
    // already producing analytics directly from the video.
    set({
      processingStatus: 'error',
      error: 'No YOLO26 worker connected.',
    })
  },

  startRealtimeTracking: async () => {
    const { sessionId, videoData, backendMode } = get()
    if (!sessionId) {
      set({
        error: 'No session available. Please refresh the page.',
        processingStatus: 'error',
      })
      return
    }
    if (!videoData) {
      set({
        error: 'No video uploaded. Please upload a video first.',
        processingStatus: 'error',
      })
      return
    }
    if (backendMode === 'worker' && !(await get().ensureWorkerUpload())) {
      set({ processingStatus: 'error' })
      return
    }

    if (backendMode !== 'worker') {
      set({
        processingStatus: 'idle',
        error: 'Worker streaming needs the YOLO26 worker. Live browser analysis is already running — just press play.',
      })
      return
    }

    try {
      set({
        processingStatus: 'realtime',
        isRealtimeMode: true,
        error: null,
      })
      get().connectRealtimeWebSocket()
    } catch (error) {
      console.error('Error starting real-time tracking:', error)
      set({
        processingStatus: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  },

  stopRealtimeTracking: () => {
    const { realtimeConnection, realtimeFrameUrl } = get()
    if (realtimeConnection) {
      realtimeConnection.close()
    }
    if (realtimeFrameUrl) {
      URL.revokeObjectURL(realtimeFrameUrl)
    }
    set({
      processingStatus: 'idle',
      isRealtimeMode: false,
      realtimeConnection: null,
      realtimeFrameUrl: null,
    })
  },

  connectRealtimeWebSocket: () => {
    const { sessionId, realtimeConnection, realtimeFrameUrl } = get()
    if (!sessionId || !WORKER_HTTP) {
      set({
        processingStatus: 'error',
        error: 'Real-time tracking needs the YOLO worker. Start the worker or use batch tracking.',
      })
      return
    }

    if (realtimeConnection) {
      realtimeConnection.close()
    }
    if (realtimeFrameUrl) {
      URL.revokeObjectURL(realtimeFrameUrl)
    }

    const socket = new WebSocket(workerWsUrl(`/sessions/${sessionId}/realtime`))
    socket.binaryType = 'arraybuffer'

    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'ERROR') {
            set({ processingStatus: 'error', error: data.message, isRealtimeMode: false })
            socket.close()
            return
          }
          if (data.type === 'analytics' || data.possession_stats) {
            const now = Date.now()
            if (now - lastRealtimeAnalyticsAt < 160 && (data.frame_id || 0) % 30 !== 0) {
              return
            }
            lastRealtimeAnalyticsAt = now
            const analytics = {
              frame_id: data.frame_id,
              possession_stats: data.possession_stats,
              pass_stats: data.pass_stats,
              win_probability: data.win_probability,
              tracking_data: data.tracking_data || [],
              timestamp: data.timestamp || Date.now() / 1000,
              team_colors: data.team_colors || get().analyticsData?.team_colors,
            }
            const tracks = mergeRealtimeTracks(
              get().tracks,
              data.tracking_data || [],
              data.frame_id || 0,
            )
            set({ analyticsData: analytics, tracks, currentFrame: data.frame_id || get().currentFrame })
            publishAnalytics(analytics)
          }
        } catch (error) {
          console.error('Error parsing realtime message:', error)
        }
        return
      }

      const blob = new Blob([event.data], { type: 'image/jpeg' })
      const nextUrl = URL.createObjectURL(blob)
      const previous = get().realtimeFrameUrl
      set({ realtimeFrameUrl: nextUrl })
      if (previous) {
        URL.revokeObjectURL(previous)
      }
    }

    socket.onerror = () => {
      set({
        processingStatus: 'error',
        error: 'Real-time worker connection failed.',
        isRealtimeMode: false,
      })
    }

    set({ realtimeConnection: socket })
  },

  setCurrentFrame: (frame: number) => {
    set({ currentFrame: frame })
  },

  setVideoDuration: (seconds: number) => {
    set({ videoDuration: Number.isFinite(seconds) ? seconds : 0 })
  },

  setLiveEnabled: (enabled: boolean) => {
    set({ liveEnabled: enabled })
    if (!enabled) {
      get().resetLive()
      if (get().processingStatus === 'live') set({ processingStatus: 'idle' })
    }
  },

  setLiveQuality: (quality: DetectorQuality) => {
    set({ liveQuality: quality })
  },

  setLiveStatus: (status: LiveStatus) => {
    set({ liveStatus: status })
  },

  ingestLiveFrame: (frame: LiveFrame) => {
    pendingLiveFrame = frame
    if (liveFlushTimer) return
    liveFlushTimer = setTimeout(() => {
      liveFlushTimer = null
      const queued = pendingLiveFrame
      pendingLiveFrame = null
      if (!queued) return
      const state = get()
      // A worker batch job owns the track store while it runs; do not fight it.
      if (state.processingStatus === 'processing' || state.processingStatus === 'realtime') return

      const tracks = mergeRealtimeTracks(state.tracks, queued.tracking_data, queued.frame_id)
      const analytics = {
        frame_id: queued.frame_id,
        possession_stats: null as any,
        pass_stats: null as any,
        tracking_data: [] as any[],
        timestamp: queued.timestamp,
        team_colors: queued.team_colors || state.analyticsData?.team_colors,
        resolution: queued.resolution,
      }
      set({
        tracks,
        analyticsData: analytics as any,
        currentFrame: queued.frame_id,
        videoFps: queued.fps || state.videoFps,
        processingStatus: 'live',
        liveFrameCount: state.liveFrameCount + 1,
        error: null,
      })
      publishAnalytics(analytics as any)
    }, LIVE_FLUSH_MS)
  },

  resetLive: () => {
    if (liveFlushTimer) {
      clearTimeout(liveFlushTimer)
      liveFlushTimer = null
    }
    pendingLiveFrame = null
    set({ tracks: new Map(), analyticsData: null, liveFrameCount: 0, currentFrame: 0 })
  },

  reset: () => {
    const { wsConnection, realtimeConnection, videoUrl, realtimeFrameUrl } = get()
    if (wsConnection) {
      wsConnection.close()
    }
    if (realtimeConnection) {
      realtimeConnection.close()
    }
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl)
    }
    if (realtimeFrameUrl) {
      URL.revokeObjectURL(realtimeFrameUrl)
    }
    stopJobPoll()
    set({
      sessionId: null,
      videoData: null,
      videoUrl: null,
      tracks: new Map(),
      calibration: null,
      jobId: null,
      wsConnection: null,
      realtimeConnection: null,
      processingStatus: 'idle',
      progress: 0,
      error: null,
      currentFrame: 0,
      totalFrames: 0,
      isRealtimeMode: false,
      realtimeFrameUrl: null,
      analyticsData: null,
      videoReady: false,
      isUploading: false,
      pendingFile: null,
      workerVideoReady: false,
      videoFps: 30,
      frameStride: 1,
      liveStatus: null,
      liveFrameCount: 0,
    })
    get().createSession()
  },
}))
