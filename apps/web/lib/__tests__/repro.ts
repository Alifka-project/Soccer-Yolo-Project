import { deriveAnalytics } from '../analytics'

// 1920x1080 broadcast, 30 fps video, live detector runs at ~12 Hz
// => a detection every ~2.5 video frames (dt ~= 0.083 s).
const FPS = 30
const STEP = 3 // video frames between detections (10 Hz analysis)

function persp(yFeet: number) {
  // apparent height in px at a given feet row (linear perspective)
  return 0.22 * yFeet - 30
}

function mkTrack(id: string, team: string, yFeet: number, x0: number, opts: {
  jitterPx?: number
  switchAt?: number
  switchPx?: number
  mps?: number
} = {}) {
  const h = persp(yFeet)
  const mPerPx = 1.8 / h
  const jitter = opts.jitterPx ?? 0
  const positions: any[] = []
  let x = x0
  let rnd = 12345
  const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff - 0.5 }
  const n = Math.floor((12 * FPS) / STEP) // 12 seconds
  for (let i = 0; i < n; i++) {
    const frame = i * STEP
    const speed = opts.mps ?? 1.5 // m/s of genuine motion
    x += (speed * (STEP / FPS)) / mPerPx
    if (opts.switchAt != null && i === opts.switchAt) x += opts.switchPx ?? 0
    positions.push({
      frame,
      x: x + rand() * jitter,
      y: yFeet - h + rand() * jitter,
      w: h * 0.4,
      h,
      score: 0.9,
    })
  }
  return { id, class: 'person', team, color: team === 'team_a' ? '#E11D48' : '#2563EB', positions }
}

const map = new Map<string, any>()
// a spread of depths so the perspective fit calibrates
const depths = [980, 900, 820, 740, 660, 580, 500, 430]
depths.forEach((yFeet, i) => {
  map.set(String(i), mkTrack(String(i), i % 2 ? 'team_b' : 'team_a', yFeet, 300 + i * 150, { jitterPx: 4 }))
})
// far player, small box, with one identity switch of 150 px (under the 180 px gate)
map.set('99', mkTrack('99', 'team_a', 460, 700, { jitterPx: 4, switchAt: 40, switchPx: 150 }))

const derived = deriveAnalytics(map, { frame_id: 360, resolution: [1920, 1080] }, FPS)
console.log('metersPerPixel(reported):', derived.extras.metersPerPixel.toFixed(5))
for (const p of derived.players) {
  console.log(
    `P${p.id}  dist ${p.distanceM.toFixed(1)} m  time ${p.timeOnField.toFixed(1)} s  ` +
    `avg ${p.avgSpeedM.toFixed(1)} m/s  max ${p.maxSpeedM.toFixed(1)} m/s (${(p.maxSpeedM * 3.6).toFixed(0)} km/h)  sprints ${p.sprints}`,
  )
}
console.log('compactness A/B m2:', derived.extras.compactnessA, derived.extras.compactnessB)
console.log('team A width/depth m:', derived.team.teamA.widthM.toFixed(1), derived.team.teamA.depthM.toFixed(1))
console.log('separation m:', derived.team.separationM.toFixed(1))
console.log('possession s:', derived.possession.total_possession_time.toFixed(2))
console.log('pass distances (raw field):', derived.passes.recent_passes.map((p) => p.distance.toFixed(1)).join(', '))
console.log('pass distances as UI renders them (x metersPerPixel):',
  derived.passes.recent_passes.map((p) => (p.distance * derived.extras.metersPerPixel).toFixed(1)).join(', '))
