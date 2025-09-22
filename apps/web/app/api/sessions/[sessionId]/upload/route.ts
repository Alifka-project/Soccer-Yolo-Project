import { NextRequest, NextResponse } from 'next/server'

// In-memory storage (use cloud storage in production)
const sessions: Map<string, any> = new Map()

// Configure runtime for better compatibility
export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    console.log('Upload API called for session:', params.sessionId)
    
    const sessionId = params.sessionId
    
    if (!sessions.has(sessionId)) {
      console.log('Session not found:', sessionId)
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }
    
    // Parse form data more carefully
    let formData
    try {
      formData = await request.formData()
      console.log('Form data parsed successfully')
    } catch (error) {
      console.error('Form data parsing error:', error)
      return NextResponse.json(
        { error: 'Invalid form data' },
        { status: 400 }
      )
    }
    
    const file = formData.get('file') as File
    
    if (!file) {
      console.log('No file found in form data')
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }
    
    console.log('File received:', file.name, 'Size:', file.size)
    
    // Check file size (limit to 40MB to be safe under Vercel's 50MB limit)
    const maxSize = 40 * 1024 * 1024 // 40MB
    if (file.size > maxSize) {
      console.log('File too large:', file.size)
      return NextResponse.json(
        { 
          error: `File too large. Maximum size is 40MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB`,
          maxSize: '40MB',
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
    
    console.log('Upload successful for file:', file.name)
    
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
      { error: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    )
  }
}
