import { create } from 'zustand'
import { BackendMode, WORKER_HTTP, hasWorkerConfig, workerHttpUrl, workerWsUrl } from './config'
import { generateDemoAnalytics, runDemoJob } from './demo-engine'

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
  processingStatus: 'idle' | 'processing' | 'completed' | 'error' | 'realtime'
  progress: number
  error: string | null
  currentFrame: number
  totalFrames: number
  isRealtimeMode: boolean
  realtimeFrameUrl: string | null
  analyticsData: AnalyticsData | null
  backendMode: BackendMode
  workerInfo: WorkerInfo | null

  createSession: () => Promise<void>
  uploadVideo: (file: File) => Promise<void>
  startTracking: (mode: string) => Promise<void>
  startRealtimeTracking: () => Promise<void>
  stopRealtimeTracking: () => void
  connectWebSocket: () => void
  connectRealtimeWebSocket: () => void
  reset: () => void
  setCurrentFrame: (frame: number) => void
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
      console.warn('Worker unavailable, using dashboard demo mode', error)
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
    const { sessionId, backendMode, videoUrl: previousUrl } = get()
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

    const localUrl = URL.createObjectURL(file)
    set({
      videoData: {
        name: file.name,
        size: file.size,
        type: file.type,
      },
      videoUrl: localUrl,
      processingStatus: 'idle',
      error: null,
      tracks: new Map(),
      analyticsData: null,
      progress: 0,
    })

    if (backendMode !== 'worker') {
      return
    }

    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(workerHttpUrl(`/sessions/${sessionId}/upload`), {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`Upload failed: ${res.status} ${res.statusText} - ${errorText}`)
      }
    } catch (error) {
      console.error('Video upload error:', error)
      set({
        error: `Worker upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        processingStatus: 'error',
      })
    }
  },

  startTracking: async (mode: string) => {
    const { sessionId, videoData, backendMode } = get()
    if (!sessionId) return
    if (!videoData) {
      set({
        error: 'No video uploaded. Please upload a video first.',
        processingStatus: 'error',
      })
      return
    }

    try {
      set({ processingStatus: 'processing', progress: 0, error: null })

      if (backendMode !== 'worker') {
        const result = await runDemoJob((pct) => set({ progress: pct }))
        const tracks = new Map(Object.entries(result.tracks))
        set({
          processingStatus: 'completed',
          progress: 100,
          tracks,
          analyticsData: result.analytics,
          totalFrames: result.totalFrames,
        })
        publishAnalytics(result.analytics)
        return
      }

      const res = await fetch(workerHttpUrl(`/sessions/${sessionId}/jobs`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, tracker: 'bytetrack' }),
      })
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`)
      }
      const data = await res.json()
      set({ jobId: data.jobId })
      get().connectWebSocket()
    } catch (error) {
      console.error('Error starting tracking:', error)
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
            set({ progress: data.pct })
            return
          }
          if (data.type === 'DONE') {
            const tracks = new Map(Object.entries(data.summary?.tracks || {}))
            const analytics = {
              frame_id: data.summary?.total_frames || 0,
              possession_stats: data.summary?.possession_stats,
              pass_stats: data.summary?.pass_stats,
              tracking_data: [],
              timestamp: Date.now() / 1000,
            }
            set({
              processingStatus: 'completed',
              progress: 100,
              tracks,
              totalFrames: data.summary?.total_frames || 0,
              analyticsData: analytics,
              wsConnection: null,
            })
            publishAnalytics(analytics)
            socket.close()
            return
          }
          if (data.type === 'ERROR') {
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
        set({
          processingStatus: 'error',
          error: 'Lost connection to the YOLO worker while processing.',
        })
      }

      set({ wsConnection: socket })
      return
    }

    const eventSource = new EventSource(`/api/sessions/${sessionId}/stream?jobId=${jobId}`)
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'PROGRESS') {
          set({ progress: data.pct })
        } else if (data.type === 'DONE') {
          const tracks = new Map(Object.entries(data.summary?.tracks || {}))
          const analytics = generateDemoAnalytics(data.summary?.tracks || {})
          set({
            processingStatus: 'completed',
            progress: 100,
            tracks,
            totalFrames: data.summary?.total_frames || 240,
            analyticsData: analytics,
          })
          publishAnalytics(analytics)
          eventSource.close()
        } else if (data.type === 'ERROR') {
          set({
            processingStatus: 'error',
            error: data.message || 'Processing error occurred',
          })
          eventSource.close()
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error)
      }
    }
    eventSource.onerror = () => {
      set({
        processingStatus: 'error',
        error: 'Connection error occurred',
      })
      eventSource.close()
    }
    set({ wsConnection: eventSource as any })
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

    if (backendMode !== 'worker') {
      set({
        processingStatus: 'realtime',
        isRealtimeMode: true,
        error: null,
      })
      const result = await runDemoJob((pct) => set({ progress: pct }))
      const tracks = new Map(Object.entries(result.tracks))
      set({
        tracks,
        analyticsData: result.analytics,
        totalFrames: result.totalFrames,
      })
      publishAnalytics(result.analytics)
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
            const analytics = {
              frame_id: data.frame_id,
              possession_stats: data.possession_stats,
              pass_stats: data.pass_stats,
              tracking_data: data.tracking_data || [],
              timestamp: data.timestamp || Date.now() / 1000,
            }
            set({ analyticsData: analytics })
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
    })
    get().createSession()
  },
}))
