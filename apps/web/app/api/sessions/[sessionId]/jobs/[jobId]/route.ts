import { NextResponse } from 'next/server'
import { generateDemoAnalytics, generateDemoTracks } from '@/lib/demo-engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const tracks = generateDemoTracks()
  const analytics = generateDemoAnalytics(tracks)
  return NextResponse.json({
    status: 'done',
    fps: 30,
    progressPct: 100,
    summary: {
      total_tracks: Object.keys(tracks).length,
      total_frames: 240,
      tracks,
      possession_stats: analytics.possession_stats,
      pass_stats: analytics.pass_stats,
    },
  })
}
