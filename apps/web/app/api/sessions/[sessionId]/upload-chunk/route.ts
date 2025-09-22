import { NextRequest, NextResponse } from 'next/server'

// In-memory storage for demo (use cloud storage in production)
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
    
    // For demo purposes, accept larger files and simulate upload
    const session = sessions.get(sessionId)
    
    // Simulate video metadata
    session.video_metadata = {
      name: file.name,
      size: file.size,
      type: file.type,
      uploaded_at: new Date().toISOString(),
      chunked: true
    }
    
    // Basic video info
    session.fps = 30
    session.resolution = [1920, 1080]
    session.video_size = file.size
    
    sessions.set(sessionId, session)
    
    return NextResponse.json({
      receivedBytes: file.size,
      done: true,
      message: 'Video uploaded successfully (chunked demo mode)',
      metadata: {
        name: file.name,
        size: file.size,
        type: file.type,
        chunked: true
      }
    })
  } catch (error) {
    console.error('Chunked upload error:', error)
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    )
  }
}
