import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    return NextResponse.json({
      receivedBytes: file.size,
      done: true,
      message: 'Chunk accepted',
      metadata: {
        name: file.name,
        size: file.size,
        type: file.type,
        chunked: true,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
