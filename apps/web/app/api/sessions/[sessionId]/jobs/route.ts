import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    return NextResponse.json({
      jobId: crypto.randomUUID(),
      mode: body.mode || 'preview',
      tracker: body.tracker || 'bytetrack',
      status: 'queued',
    })
  } catch {
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
  }
}
