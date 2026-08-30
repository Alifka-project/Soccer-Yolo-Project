import { generateDemoAnalytics, generateDemoTracks } from '@/lib/demo-engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const encoder = new TextEncoder()
  const tracks = generateDemoTracks()
  const analytics = generateDemoAnalytics(tracks)

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      let progress = 0
      const interval = setInterval(() => {
        progress += 12
        if (progress >= 100) {
          send({ type: 'PROGRESS', pct: 100 })
          send({
            type: 'DONE',
            summary: {
              total_frames: 240,
              total_tracks: Object.keys(tracks).length,
              processing_time: 8,
              tracks,
              possession_stats: analytics.possession_stats,
              pass_stats: analytics.pass_stats,
            },
          })
          clearInterval(interval)
          controller.close()
          return
        }
        send({ type: 'PROGRESS', pct: progress })
      }, 180)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
