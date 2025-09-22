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
    
    // Check file size (limit to 45MB to stay under Vercel's 50MB limit)
    const maxSize = 45 * 1024 * 1024 // 45MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { 
          error: `File too large. Maximum size is 45MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB`,
          maxSize: '45MB',
          fileSize: `${(file.size / 1024 / 1024).toFixed(1)}MB`
        },
        { status: 413 }
      )
    }
    
    // For demo purposes, we'll simulate video processing without storing the actual file
    // In production, you'd upload to cloud storage (S3, Vercel Blob, etc.)
    const session = sessions.get(sessionId)
    
    // Simulate video metadata instead of storing the actual file
    session.video_metadata = {
      name: file.name,
      size: file.size,
      type: file.type,
      uploaded_at: new Date().toISOString()
    }
    
    // Basic video info (in production, use ffprobe or similar)
    session.fps = 30 // Default
    session.resolution = [1920, 1080] // Default
    session.video_size = file.size
    
    sessions.set(sessionId, session)
    
    return NextResponse.json({
      receivedBytes: file.size,
      done: true,
      message: 'Video uploaded successfully (demo mode)',
      metadata: {
        name: file.name,
        size: file.size,
        type: file.type
      }
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    )
  }
}
