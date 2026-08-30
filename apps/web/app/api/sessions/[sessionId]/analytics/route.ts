import { NextResponse } from 'next/server'
import { generateDemoAnalytics, generateDemoTracks } from '@/lib/demo-engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const tracks = generateDemoTracks()
  return NextResponse.json(generateDemoAnalytics(tracks))
}
