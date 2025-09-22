import { NextRequest, NextResponse } from 'next/server'

// In-memory storage
const sessions: Map<string, any> = new Map()
const jobs: Map<string, any> = new Map()

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string; jobId: string } }
) {
  try {
    const { sessionId, jobId } = params
    
    if (!jobs.has(jobId)) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }
    
    const job = jobs.get(jobId)
    const session = sessions.get(sessionId)
    
    return NextResponse.json({
      status: job.status,
      fps: session?.fps || 30,
      progressPct: job.progress,
      summary: job.summary
    })
  } catch (error) {
    console.error('Job status error:', error)
    return NextResponse.json(
      { error: 'Failed to get job status' },
      { status: 500 }
    )
  }
}
