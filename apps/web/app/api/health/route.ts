import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const workerUrl = process.env.WORKER_URL || process.env.NEXT_PUBLIC_WORKER_HTTP_BASE || ''

  if (!workerUrl) {
    return NextResponse.json({
      ok: true,
      mode: 'browser',
      worker: null,
      message: 'No YOLO26 worker configured. Detection and analytics run in the browser.',
    })
  }

  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/health`, { cache: 'no-store' })
    const worker = await res.json().catch(() => null)
    return NextResponse.json({
      ok: res.ok,
      mode: res.ok ? 'worker' : 'browser',
      worker,
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      mode: 'browser',
      worker: null,
      error: error instanceof Error ? error.message : 'Worker unreachable',
    })
  }
}
