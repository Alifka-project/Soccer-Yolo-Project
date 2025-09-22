import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

// In-memory session storage (for demo - use Redis in production)
const sessions: Map<string, any> = new Map()
const SESSION_TTL = 30 * 60 * 1000 // 30 minutes

export async function POST(request: NextRequest) {
  try {
    const sessionId = uuidv4()
    const session = {
      id: sessionId,
      created_at: new Date().toISOString(),
      ttl_seconds: SESSION_TTL / 1000,
      video_data: null,
      fps: null,
      resolution: null,
      tracks: {},
      calibration: null,
      locked_ids: new Set()
    }
    
    sessions.set(sessionId, session)
    
    // Cleanup old sessions
    setTimeout(() => {
      sessions.delete(sessionId)
    }, SESSION_TTL)
    
    return NextResponse.json({
      sessionId,
      ttlSeconds: SESSION_TTL / 1000
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('sessionId')
  
  if (!sessionId || !sessions.has(sessionId)) {
    return NextResponse.json(
      { error: 'Session not found' },
      { status: 404 }
    )
  }
  
  const session = sessions.get(sessionId)
  return NextResponse.json(session)
}
