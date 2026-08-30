import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const workerUrl = process.env.WORKER_URL || process.env.NEXT_PUBLIC_WORKER_HTTP_BASE || ''

  if (!workerUrl) {
    return NextResponse.json({
      ok: true,
      mode: 'demo',
      worker: null,
      message: 'No YOLO worker configured. The dashboard runs in demo mode on Vercel.',
    })
  }

  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/health`, { cache: 'no-store' })
    const worker = await res.json().catch(() => null)
    return NextResponse.json({
      ok: res.ok,
      mode: res.ok ? 'worker' : 'demo',
      worker,
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      mode: 'demo',
      worker: null,
      error: error instanceof Error ? error.message : 'Worker unreachable',
    })
  }
}
