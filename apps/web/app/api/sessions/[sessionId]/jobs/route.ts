import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

// In-memory storage
const sessions: Map<string, any> = new Map()
const jobs: Map<string, any> = new Map()

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const sessionId = params.sessionId
    
    if (!sessions.has(sessionId)) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }
    
    const body = await request.json()
    const { mode = 'preview', tracker = 'bytetrack' } = body
    
    const jobId = uuidv4()
    const job = {
      id: jobId,
      session_id: sessionId,
      status: 'queued',
      mode,
      tracker,
      progress: 0,
      created_at: new Date().toISOString()
    }
    
    jobs.set(jobId, job)
    
    // Start processing in background (serverless-friendly)
    processVideoAsync(jobId, sessionId)
    
    return NextResponse.json({ jobId })
  } catch (error) {
    console.error('Job creation error:', error)
    return NextResponse.json(
      { error: 'Failed to create job' },
      { status: 500 }
    )
  }
}

// Serverless-friendly video processing
async function processVideoAsync(jobId: string, sessionId: string) {
  const job = jobs.get(jobId)
  if (!job) return
  
  try {
    job.status = 'running'
    jobs.set(jobId, job)
    
    const session = sessions.get(sessionId)
    if (!session || !session.video_data) {
      job.status = 'error'
      job.error = 'No video data found'
      jobs.set(jobId, job)
      return
    }
    
    // Simulate video processing (replace with actual processing)
    const totalFrames = 1000 // Simulated
    let progress = 0
    
    for (let frame = 0; frame < totalFrames; frame++) {
      // Simulate frame processing
      await new Promise(resolve => setTimeout(resolve, 10))
      
      progress = Math.round((frame / totalFrames) * 100)
      job.progress = progress
      jobs.set(jobId, job)
    }
    
    // Generate mock tracking data
    const mockTracks: Record<string, any> = {}
    for (let i = 0; i < 10; i++) {
      mockTracks[i.toString()] = {
        id: i,
        positions: Array.from({ length: 100 }, (_, j) => ({
          frame: j,
          x: Math.random() * 1920,
          y: Math.random() * 1080,
          w: 50,
          h: 100,
          score: 0.8 + Math.random() * 0.2
        })),
        team: i < 5 ? 'team_a' : 'team_b',
        jersey: (i % 11) + 1
      }
    }
    
    session.tracks = mockTracks
    sessions.set(sessionId, session)
    
    job.status = 'done'
    job.progress = 100
    job.summary = {
      total_tracks: Object.keys(mockTracks).length,
      total_frames: totalFrames,
      processing_time: 30.0,
      tracks: mockTracks
    }
    jobs.set(jobId, job)
    
  } catch (error) {
    console.error('Processing error:', error)
    job.status = 'error'
    job.error = error instanceof Error ? error.message : 'Unknown error'
    jobs.set(jobId, job)
  }
}
