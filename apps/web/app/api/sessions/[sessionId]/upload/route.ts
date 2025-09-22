import { NextRequest, NextResponse } from 'next/server'

// In-memory storage (use cloud storage in production)
const sessions: Map<string, any> = new Map()

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
    
    const formData = await request.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }
    
    // Convert file to buffer
    const buffer = await file.arrayBuffer()
    const videoData = Buffer.from(buffer)
    
    // Get session and update with video data
    const session = sessions.get(sessionId)
    session.video_data = videoData
    session.video_size = videoData.length
    
    // Basic video info (in production, use ffprobe or similar)
    session.fps = 30 // Default
    session.resolution = [1920, 1080] // Default
    
    sessions.set(sessionId, session)
    
    return NextResponse.json({
      receivedBytes: videoData.length,
      done: true
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    )
  }
}
