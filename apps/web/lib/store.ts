import { create } from 'zustand'

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

interface SessionState {
  sessionId: string | null
  ttl: number
  videoData: any
  videoUrl: string | null
  tracks: Map<string, any>
  calibration: any
  jobId: string | null
  wsConnection: WebSocket | null
  realtimeConnection: WebSocket | null
  processingStatus: 'idle' | 'processing' | 'completed' | 'error' | 'realtime'
  progress: number
  error: string | null
  currentFrame: number
  totalFrames: number
  isRealtimeMode: boolean
  realtimeFrameUrl: string | null
  analyticsData: AnalyticsData | null
  
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

// Use Next.js API routes for Vercel deployment
const API_BASE = process.env.NODE_ENV === 'production' 
  ? '' // Use relative URLs in production
  : 'http://localhost:3000' // Use localhost in development

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

  createSession: async () => {
    try {
      console.log('Creating session...')
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      
      if (!res.ok) {
        throw new Error(`Session creation failed: ${res.status} ${res.statusText}`)
      }
      
      const data = await res.json()
      console.log('Session created:', data)
      set({ sessionId: data.sessionId, ttl: data.ttlSeconds })
    } catch (error) {
      console.error('Session creation error:', error)
      set({ 
        error: `Session creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        processingStatus: 'error'
      })
    }
  },

  uploadVideo: async (file: File) => {
    const { sessionId } = get()
    if (!sessionId) {
      console.error('No session ID available for upload')
      set({ 
        error: 'No session available. Please refresh the page.',
        processingStatus: 'error'
      })
      return
    }

    console.log('Uploading video for session:', sessionId, 'File:', file.name, 'Size:', file.size)

    try {
      set({ processingStatus: 'processing', progress: 0 })
      
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/upload`, {
        method: 'POST',
        body: formData
      })
      
      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`Upload failed: ${res.status} ${res.statusText} - ${errorText}`)
      }
      
      const data = await res.json()
      console.log('Upload response:', data)
      
      // Set video data (demo mode - no actual video URL needed)
      console.log('Video uploaded successfully')
      
      set({ 
        videoData: { 
          size: data.receivedBytes,
          name: data.metadata?.name || file.name,
          type: data.metadata?.type || file.type
        },
        videoUrl: null, // Demo mode - no actual video streaming
        processingStatus: 'idle',
        error: null
      })
    } catch (error) {
      console.error('Video upload error:', error)
      set({ 
        error: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        processingStatus: 'error'
      })
    }
  },

  startTracking: async (mode: string) => {
    const { sessionId } = get()
    if (!sessionId) return

    try {
      set({ processingStatus: 'processing', progress: 0, error: null })
      
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, tracker: 'bytetrack' })
      })
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`)
      }
      
      const data = await res.json()
      set({ jobId: data.jobId })
      
      // Connect WebSocket
      get().connectWebSocket()
    } catch (error) {
      console.error('Error starting tracking:', error)
      set({ 
        processingStatus: 'error', 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      })
    }
  },

  connectWebSocket: () => {
    const { sessionId, jobId } = get()
    if (!sessionId || !jobId) return

    // Use Server-Sent Events for Vercel compatibility
    const eventSource = new EventSource(`${API_BASE}/api/sessions/${sessionId}/stream?jobId=${jobId}`)
    
    eventSource.onopen = () => {
      console.log('EventSource connected')
      set({ wsConnection: eventSource as any })
    }
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('SSE message:', data)
        
        switch (data.type) {
          case 'PROGRESS':
            set({ progress: data.pct })
            break
          case 'DONE':
            set({ 
              processingStatus: 'completed', 
              progress: 100,
              tracks: new Map(Object.entries(data.summary.tracks || {})),
              totalFrames: data.summary.total_frames || 0
            })
            eventSource.close()
            break
          case 'ERROR':
            set({ 
              processingStatus: 'error', 
              error: data.message || 'Processing error occurred' 
            })
            eventSource.close()
            break
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error)
      }
    }
    
    eventSource.onerror = (error) => {
      console.error('EventSource error:', error)
      set({ 
        processingStatus: 'error', 
        error: 'Connection error occurred' 
      })
      eventSource.close()
    }
  },

  startRealtimeTracking: async () => {
    const { sessionId, videoData } = get()
    if (!sessionId) {
      set({ 
        error: 'No session available. Please refresh the page.',
        processingStatus: 'error'
      })
      return
    }
    
    if (!videoData) {
      set({ 
        error: 'No video uploaded. Please upload a video first.',
        processingStatus: 'error'
      })
      return
    }

    try {
      console.log('Starting real-time tracking for session:', sessionId)
      set({ 
        processingStatus: 'realtime', 
        isRealtimeMode: true,
        error: null 
      })
      
      // Connect to real-time WebSocket
      get().connectRealtimeWebSocket()
    } catch (error) {
      console.error('Error starting real-time tracking:', error)
      set({ 
        processingStatus: 'error', 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      })
    }
  },

  stopRealtimeTracking: () => {
    const { realtimeConnection } = get()
    if (realtimeConnection) {
      realtimeConnection.close()
    }
    set({ 
      processingStatus: 'idle',
      isRealtimeMode: false,
      realtimeConnection: null
    })
  },

  connectRealtimeWebSocket: () => {
    const { sessionId } = get()
    if (!sessionId) return

    // Close existing connection if any
    const { realtimeConnection } = get()
    if (realtimeConnection) {
      realtimeConnection.close()
    }

    // Note: Real-time WebSocket not supported in Vercel serverless mode
    // This would need to be replaced with Server-Sent Events or external WebSocket service
    console.log('Real-time WebSocket not available in serverless mode')
    set({ 
      processingStatus: 'error', 
      error: 'Real-time mode not supported in Vercel deployment. Use file upload mode instead.' 
    })
  },

  setCurrentFrame: (frame: number) => {
    set({ currentFrame: frame })
  },

  reset: () => {
    const { wsConnection, realtimeConnection } = get()
    if (wsConnection) {
      wsConnection.close()
    }
    if (realtimeConnection) {
      realtimeConnection.close()
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
      isRealtimeMode: false
    })
  }
}))

