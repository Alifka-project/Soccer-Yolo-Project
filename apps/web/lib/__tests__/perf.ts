import { deriveAnalytics, mergeRealtimeTracks } from '../analytics'

/**
 * Benchmarks the per-update analytics cost at realistic live-session scale:
 * a full squad plus the ball, each carrying the maximum retained history.
 */

function buildLiveState(players: number, historyFrames: number) {
  const map = new Map<string, any>()
  for (let i = 0; i < players; i++) {
    const team = i < players / 2 ? 'team_a' : 'team_b'
    const positions = []
    for (let f = 0; f < historyFrames; f++) {
      const frame = f * 3
      positions.push({
        frame,
        x: 200 + (i % 11) * 90 + Math.sin(frame / 20 + i) * 60,
        y: 150 + Math.floor(i / 11) * 200 + Math.cos(frame / 25 + i) * 80,
        w: 40,
        h: 92,
        score: 0.9,
      })
    }
    map.set(String(i), {
      id: String(i),
      class: 'person',
      team,
      color: team === 'team_a' ? '#E11D48' : '#2563EB',
      positions,
    })
  }
  const ball = []
  for (let f = 0; f < historyFrames; f++) {
    const frame = f * 3
    ball.push({ frame, x: 620 + Math.sin(frame / 8) * 400, y: 380 + Math.cos(frame / 11) * 180, w: 14, h: 14, score: 0.5 })
  }
  map.set('ball', { id: 'ball', class: 'ball', team: 'ball', color: '#F8FAFC', positions: ball })
  return map
}

function bench(label: string, iterations: number, fn: () => void) {
  fn() // warm up
  const started = process.hrtime.bigint()
  for (let i = 0; i < iterations; i++) fn()
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
  const per = elapsedMs / iterations
  console.log(`  ${label.padEnd(46)} ${per.toFixed(2)} ms/call`)
  return per
}

const PLAYERS = 22
const HISTORY = 160 // 480 retained positions at the 3-frame live stride

console.log(`\n[analytics perf] ${PLAYERS} players + ball, ${HISTORY} samples each`)
const tracks = buildLiveState(PLAYERS, HISTORY)
const analytics = { frame_id: HISTORY * 3, resolution: [1280, 720], tracking_data: [] }

const derivePer = bench('deriveAnalytics (full live state)', 20, () => {
  deriveAnalytics(tracks, analytics, 30)
})

const incoming = Array.from({ length: PLAYERS + 1 }, (_, i) => ({
  track_id: i,
  bbox: [100 + i * 40, 200, 40, 92],
  class: i === PLAYERS ? 'ball' : 'person',
  confidence: 0.9,
  team: i < PLAYERS / 2 ? 'team_a' : 'team_b',
}))
const mergePer = bench('mergeRealtimeTracks (one frame)', 50, () => {
  mergeRealtimeTracks(tracks, incoming, HISTORY * 3 + 3)
})

const total = derivePer + mergePer
const budget = 260 // the store's live flush interval
console.log(`\n  total per live update: ${total.toFixed(2)} ms (budget ${budget} ms)`)
console.log(total < budget * 0.5 ? '  VERDICT: comfortable\n' : total < budget ? '  VERDICT: within budget but tight\n' : '  VERDICT: OVER BUDGET\n')
process.exit(total < budget ? 0 : 1)
