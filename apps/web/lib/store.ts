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

const WORKER_HTTP = process.env.NEXT_PUBLIC_WORKER_HTTP_BASE || 'http://localhost:8001'
const WORKER_WS = process.env.NEXT_PUBLIC_WORKER_WS_BASE || 'ws://localhost:8001'

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
      const res = await fetch(`${WORKER_HTTP}/sessions`, {
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

      const res = await fetch(`${WORKER_HTTP}/sessions/${sessionId}/upload`, {
        method: 'POST',
        body: formData
      })
      
      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`Upload failed: ${res.status} ${res.statusText} - ${errorText}`)
      }
      
      const data = await res.json()
      console.log('Upload response:', data)
      
      // Set video data and create video URL
      const videoUrl = `${WORKER_HTTP}/sessions/${sessionId}/video`
      console.log('Video uploaded successfully, URL:', videoUrl)
      
      set({ 
        videoData: { size: data.receivedBytes },
        videoUrl: videoUrl,
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
      
      const res = await fetch(`${WORKER_HTTP}/sessions/${sessionId}/jobs`, {
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

    // Close existing connection if any
    const { wsConnection } = get()
    if (wsConnection) {
      wsConnection.close()
    }

    const ws = new WebSocket(`${WORKER_WS}/sessions/${sessionId}/stream?jobId=${jobId}`)
    
    ws.onopen = () => {
      console.log('WebSocket connected')
      set({ wsConnection: ws })
    }
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('WS message:', data)
        
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
            break
          case 'ERROR':
            set({ 
              processingStatus: 'error', 
              error: data.message || 'Processing error occurred' 
            })
            break
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error)
      }
    }
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      set({ 
        processingStatus: 'error', 
        error: 'WebSocket connection error' 
      })
    }
    
    ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason)
      set({ wsConnection: null })
      
      // If processing was in progress and connection closed unexpectedly
      const { processingStatus } = get()
      if (processingStatus === 'processing') {
        set({ 
          processingStatus: 'error', 
          error: 'Connection lost during processing' 
        })
      }
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

    const ws = new WebSocket(`${WORKER_WS}/sessions/${sessionId}/realtime`)
    let reconnectAttempts = 0
    const maxReconnectAttempts = 3
    
    const attemptReconnect = () => {
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++
        console.log(`Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})...`)
        setTimeout(() => {
          get().connectRealtimeWebSocket()
        }, 2000)
      } else {
        set({ 
          processingStatus: 'error', 
          error: 'Real-time connection lost - max reconnection attempts reached' 
        })
      }
    }
    
    ws.onopen = () => {
      console.log('Real-time WebSocket connected')
      reconnectAttempts = 0
      set({ realtimeConnection: ws, error: null })
    }
    
    ws.onmessage = (event) => {
      try {
        // Handle binary frame data
        if (event.data instanceof Blob) {
          // Create image URL directly from blob for better performance
          const imageUrl = URL.createObjectURL(event.data)
          
          // Clean up previous frame URL to prevent memory leaks
          const { realtimeFrameUrl } = get()
          if (realtimeFrameUrl) {
            URL.revokeObjectURL(realtimeFrameUrl)
          }
          
          // Store the latest frame for display
          set({ 
            currentFrame: get().currentFrame + 1,
            realtimeFrameUrl: imageUrl
          })
          
          // Emit frame update event
          window.dispatchEvent(new CustomEvent('realtimeFrame', { detail: imageUrl }))
        } else {
          // Handle JSON messages (analytics data, errors, etc.)
          const data = JSON.parse(event.data)
          console.log('Real-time WS message:', data)
          
          if (data.type === 'ERROR') {
            set({ 
              processingStatus: 'error', 
              error: data.message || 'Real-time processing error occurred' 
            })
          } else if (data.type === 'analytics') {
            // Update analytics data
            console.log('📊 Received analytics data:', data)
            set({ analyticsData: data })
            
            // Emit analytics update event
            window.dispatchEvent(new CustomEvent('analyticsUpdate', { detail: data }))
          }
        }
      } catch (error) {
        console.error('Error handling real-time WebSocket message:', error)
      }
    }
    
    ws.onerror = (error) => {
      console.error('Real-time WebSocket error:', error)
      // Don't immediately set error status, let onclose handle reconnection
    }
    
    ws.onclose = (event) => {
      console.log('Real-time WebSocket closed:', event.code, event.reason)
      set({ realtimeConnection: null })
      
      // If real-time was active and connection closed unexpectedly
      const { processingStatus } = get()
      if (processingStatus === 'realtime') {
        // Attempt to reconnect
        attemptReconnect()
      }
    }
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
