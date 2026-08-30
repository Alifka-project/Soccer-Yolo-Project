import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  const sessionId = crypto.randomUUID()
  return NextResponse.json({
    sessionId,
    ttlSeconds: 1800,
    mode: 'demo',
  })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Sessions are created per request. Vercel does not share in-memory session state.',
  })
}
