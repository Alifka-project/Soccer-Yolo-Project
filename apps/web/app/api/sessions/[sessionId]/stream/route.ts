import { NextRequest } from 'next/server'

// In-memory storage
const sessions: Map<string, any> = new Map()
const jobs: Map<string, any> = new Map()

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')
  
  if (!jobId || !jobs.has(jobId)) {
    return new Response('Job not found', { status: 404 })
  }
  
  const job = jobs.get(jobId)
  
  // Create Server-Sent Events stream
  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    start(controller) {
      // Send initial progress
      const sendEvent = (type: string, data: any) => {
        const eventData = `data: ${JSON.stringify({ type, ...data })}\n\n`
        controller.enqueue(encoder.encode(eventData))
      }
      
      // Simulate progress updates
      let progress = 0
      const interval = setInterval(() => {
        progress += Math.random() * 10
        
        if (progress >= 100) {
          progress = 100
          sendEvent('PROGRESS', { pct: progress })
          
          // Send completion
          setTimeout(() => {
            const session = sessions.get(params.sessionId)
            sendEvent('DONE', {
              summary: {
                total_frames: 1000,
                total_tracks: Object.keys(session?.tracks || {}).length,
                processing_time: 30.0,
                tracks: session?.tracks || {}
              }
            })
            clearInterval(interval)
            controller.close()
          }, 1000)
        } else {
          sendEvent('PROGRESS', { pct: Math.min(progress, 99) })
        }
      }, 200)
      
      // Cleanup on close
      return () => {
        clearInterval(interval)
      }
    }
  })
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
