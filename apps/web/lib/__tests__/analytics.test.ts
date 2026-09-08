import { MultiObjectTracker } from '../vision/tracker'
import { findBallCandidates } from '../vision/ball-finder'
import { TeamClassifier } from '../vision/team-classifier'
import type { Detection, TrackedObject } from '../vision/types'
import { computeWinProbability, deriveAnalytics } from '../analytics'
import { computePitchMask, isPlayerOnPitch } from '../vision/pitch'

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`)
  } else {
    failures++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ---------------------------------------------------------------- tracker
console.log('\n[tracker]')
{
  const tracker = new MultiObjectTracker()
  const ids: number[][] = []
  for (let frame = 0; frame < 30; frame++) {
    const dets: Detection[] = [
      { bbox: [100 + frame * 3, 200, 40, 90], score: 0.9, class: 'person' },
      { bbox: [400 - frame * 2, 220, 42, 92], score: 0.85, class: 'person' },
      { bbox: [700, 300 + frame * 4, 38, 88], score: 0.8, class: 'person' },
      { bbox: [250 + frame * 25, 400, 12, 12], score: 0.4, class: 'ball' },
    ]
    const out = tracker.update(dets)
    ids.push(out.filter((o) => o.class === 'person').map((o) => o.id).sort((a, b) => a - b))
  }
  const settled = ids.slice(5)
  const stable = settled.every((row) => JSON.stringify(row) === JSON.stringify(settled[0]))
  check('person ids stay stable across 25 frames', stable, JSON.stringify(settled.slice(-1)))
  check('three person tracks maintained', settled[0].length === 3, `got ${settled[0].length}`)

  const last = tracker.snapshot()
  const balls = last.filter((o) => o.class === 'ball')
  check('exactly one ball track survives', balls.length === 1, `got ${balls.length}`)
  check('fast ball keeps a single id', balls[0]?.id === 4 || balls[0]?.hits > 20, `hits=${balls[0]?.hits}`)
}

{
  // Occlusion: a player disappears for 5 frames and comes back nearby.
  const tracker = new MultiObjectTracker()
  let idBefore = 0
  for (let frame = 0; frame < 12; frame++) {
    const out = tracker.update([{ bbox: [100 + frame * 4, 200, 40, 90], score: 0.9, class: 'person' }])
    if (frame === 11) idBefore = out[0].id
  }
  for (let frame = 0; frame < 5; frame++) tracker.update([])
  const after = tracker.update([{ bbox: [100 + 17 * 4, 200, 40, 90], score: 0.9, class: 'person' }])
  check('track survives a 5-frame occlusion with the same id', after[0]?.id === idBefore, `${idBefore} -> ${after[0]?.id}`)
}

// ------------------------------------------------------------ ball finder
console.log('\n[ball finder]')
function makeImage(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 46; data[i + 1] = 125; data[i + 2] = 50; data[i + 3] = 255
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData
}
function paintDisc(img: ImageData, cx: number, cy: number, r: number, rgb: [number, number, number]) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue
      const i = (y * img.width + x) * 4
      img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]
    }
  }
}
function paintRect(img: ImageData, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
      const i = (y * img.width + x) * 4
      img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]
    }
  }
}
{
  const img = makeImage(512, 288)
  paintDisc(img, 300, 150, 4, [245, 245, 245])
  const found = findBallCandidates(img)
  check('finds a white ball on grass', found.length >= 1, `found ${found.length}`)
  if (found.length) {
    const cx = found[0].bbox[0] + found[0].bbox[2] / 2
    const cy = found[0].bbox[1] + found[0].bbox[3] / 2
    check('ball position is accurate', Math.abs(cx - 300) < 3 && Math.abs(cy - 150) < 3, `${cx},${cy}`)
  }
}
{
  const img = makeImage(512, 288)
  paintRect(img, 100, 80, 26, 46, [250, 250, 250]) // white jersey torso
  const found = findBallCandidates(img, { personBoxes: [[95, 70, 36, 100]] })
  check('white jersey is not reported as a ball', found.length === 0, `found ${found.length}`)
}
{
  const img = makeImage(512, 288)
  paintRect(img, 40, 200, 300, 3, [255, 255, 255]) // pitch line
  const found = findBallCandidates(img)
  check('pitch line is not reported as a ball', found.length === 0, `found ${found.length}`)
}

// -------------------------------------------------------- team classifier
console.log('\n[team classifier]')
{
  const img = makeImage(512, 288)
  const boxes: Array<[number, number, number, number]> = []
  for (let i = 0; i < 5; i++) {
    const x = 40 + i * 40
    paintRect(img, x, 100, 20, 20, [200, 30, 40]) // red torso
    boxes.push([x - 2, 92, 24, 60])
  }
  for (let i = 0; i < 5; i++) {
    const x = 280 + i * 40
    paintRect(img, x, 100, 20, 20, [30, 60, 200]) // blue torso
    boxes.push([x - 2, 92, 24, 60])
  }
  const classifier = new TeamClassifier()
  const objects: TrackedObject[] = boxes.map((bbox, index) => ({
    id: index + 1, label: index + 1, bbox, score: 0.9, class: 'person' as const, age: 5, hits: 5,
    missed: 0, velocity: [0, 0] as [number, number], team: 'unknown' as const, coasted: false,
  }))
  let labeled = objects
  for (let pass = 0; pass < 6; pass++) labeled = classifier.update(img, 1, objects)

  const reds = labeled.slice(0, 5).map((o) => o.team)
  const blues = labeled.slice(5).map((o) => o.team)
  const redTeam = reds[0]
  const blueTeam = blues[0]
  check('red shirts land on one team', reds.every((t) => t === redTeam) && redTeam !== 'unknown', reds.join(','))
  check('blue shirts land on the other team', blues.every((t) => t === blueTeam) && blueTeam !== 'unknown', blues.join(','))
  check('the two teams are different', redTeam !== blueTeam, `${redTeam} vs ${blueTeam}`)
  const colors = classifier.teamColors
  check('team colours are recovered', Boolean(colors?.team_a && colors?.team_b), JSON.stringify(colors))
}

// ------------------------------------------------------------- analytics
console.log('\n[analytics]')
function buildTracks(opts: { withBall: boolean }) {
  const map = new Map<string, any>()
  const fps = 30
  // Two teams of 4, static-ish, with team A on the left.
  for (let i = 0; i < 8; i++) {
    const team = i < 4 ? 'team_a' : 'team_b'
    const baseX = team === 'team_a' ? 200 + (i % 4) * 60 : 700 + (i % 4) * 60
    const positions = []
    for (let f = 0; f < 90; f++) {
      positions.push({ frame: f, x: baseX + Math.sin(f / 10 + i) * 12, y: 300 + (i % 4) * 40, w: 40, h: 90, score: 0.9 })
    }
    map.set(String(i), { id: String(i), class: 'person', team, color: team === 'team_a' ? '#E11D48' : '#2563EB', positions })
  }
  if (opts.withBall) {
    const positions = []
    for (let f = 0; f < 90; f++) {
      // 60 frames (2s) beside team A players, then 30 frames (1s) beside team B.
      const x = f < 60 ? 210 + (f % 3) * 60 : 710 + (f % 3) * 60
      positions.push({ frame: f, x, y: 330, w: 14, h: 14, score: 0.5 })
    }
    map.set('ball', { id: 'ball', class: 'ball', team: 'ball', color: '#F8FAFC', positions })
  }
  return { map, fps }
}
{
  const { map, fps } = buildTracks({ withBall: true })
  const derived = deriveAnalytics(map, { frame_id: 89, resolution: [1280, 720] }, fps)
  check('possession source is the tracked ball', derived.possession.source === 'ball', derived.possession.source)
  check('possession totals ~3s', Math.abs(derived.possession.total_possession_time - 2.97) < 0.4, String(derived.possession.total_possession_time))
  check(
    'team A holds roughly two thirds',
    derived.possession.team_a_percentage > 55 && derived.possession.team_a_percentage < 78,
    `${derived.possession.team_a_percentage.toFixed(1)}%`,
  )
  check('passes were detected', derived.passes.total_passes > 0, String(derived.passes.total_passes))
  check('events were produced', derived.events.length > 0, String(derived.events.length))
  check('a turnover is on the timeline', derived.events.some((e) => e.type === 'turnover'), '')
  check('players are measured', derived.players.length === 8, String(derived.players.length))
  check('ball is reported as detected', derived.ballDetected, '')
}
{
  const { map, fps } = buildTracks({ withBall: false })
  const derived = deriveAnalytics(map, { frame_id: 89, resolution: [1280, 720] }, fps)
  check('falls back to the proximity model', derived.possession.source === 'proximity', derived.possession.source)
  check('proximity model still yields possession time', derived.possession.total_possession_time > 0.5, String(derived.possession.total_possession_time))
  check(
    'proximity percentages add to 100',
    Math.abs(derived.possession.team_a_percentage + derived.possession.team_b_percentage - 100) < 0.01,
    `${derived.possession.team_a_percentage} + ${derived.possession.team_b_percentage}`,
  )
  check('ball is reported as not detected', !derived.ballDetected, '')
}
{
  const derived = deriveAnalytics(new Map(), null, 30)
  check('empty input is not ready', !derived.ready, '')
  check('empty input yields zero possession', derived.possession.total_possession_time === 0, '')
  check('empty input yields no events', derived.events.length === 0, '')
}

{
  // Two kits under uneven lighting: half of each team is in shade. The split
  // must follow the kit colour, not the brightness.
  const img = makeImage(512, 288)
  const boxes: Array<[number, number, number, number]> = []
  const place = (x: number, rgb: [number, number, number]) => {
    paintRect(img, x, 100, 20, 20, rgb)
    boxes.push([x - 2, 92, 24, 60])
  }
  for (let i = 0; i < 4; i++) place(30 + i * 34, [200, 30, 40])   // red, lit
  for (let i = 0; i < 4; i++) place(180 + i * 34, [95, 14, 19])   // red, shaded
  for (let i = 0; i < 4; i++) place(320 + i * 34, [40, 70, 210])  // blue, lit
  for (let i = 0; i < 3; i++) place(460 + i * 12, [18, 33, 100])  // blue, shaded

  const classifier = new TeamClassifier()
  const objects: TrackedObject[] = boxes.map((bbox, index) => ({
    id: index + 1, label: index + 1, bbox, score: 0.9, class: 'person' as const, age: 5, hits: 5,
    missed: 0, velocity: [0, 0] as [number, number], team: 'unknown' as const, coasted: false,
  }))
  let labeled = objects
  for (let pass = 0; pass < 8; pass++) labeled = classifier.update(img, 1, objects)

  const teams = labeled.map((o) => o.team)
  const reds = teams.slice(0, 8)
  const blues = teams.slice(8)
  const assigned = teams.filter((t) => t === 'team_a' || t === 'team_b')
  check('most players get a team under uneven lighting', assigned.length >= 11, `${assigned.length}/15`)
  check('reds share one team across lighting', new Set(reds.filter((t) => t !== 'unknown')).size === 1, reds.join(','))
  check('blues share the other team', new Set(blues.filter((t) => t !== 'unknown')).size === 1, blues.join(','))
  check('the split is not lopsided', reds[0] !== blues[0], `${reds[0]} vs ${blues[0]}`)
}

// ------------------------------------------------ unified ownership model
console.log('\n[ownership model]')
{
  const { map, fps } = buildTracks({ withBall: true })
  const derived = deriveAnalytics(map, { frame_id: 89, resolution: [1280, 720] }, fps)
  check('ball coverage is reported', derived.ballCoverage > 0.9, derived.ballCoverage.toFixed(2))
  check('source follows coverage', derived.possession.source === 'ball', derived.possession.source)
}
{
  // Ball visible for only the first third: the model should fall back for the
  // rest but still report the partial coverage honestly.
  const { map, fps } = buildTracks({ withBall: true })
  const ball = map.get('ball')
  ball.positions = ball.positions.filter((p: any) => p.frame < 30)
  const derived = deriveAnalytics(map, { frame_id: 89, resolution: [1280, 720] }, fps)
  check(
    'partial ball coverage sits between 0 and 1',
    derived.ballCoverage > 0.05 && derived.ballCoverage < 0.8,
    derived.ballCoverage.toFixed(2),
  )
  check('possession still accumulates through the gap', derived.possession.total_possession_time > 1, String(derived.possession.total_possession_time))
}
{
  // A long pass: the holder ends up far from the ball and must give it up.
  const map = new Map<string, any>()
  const positions = (x: number) => Array.from({ length: 60 }, (_, f) => ({ frame: f, x, y: 300, w: 40, h: 90, score: 0.9 }))
  map.set('1', { id: '1', class: 'person', team: 'team_a', color: '#E11D48', positions: positions(200) })
  map.set('2', { id: '2', class: 'person', team: 'team_a', color: '#E11D48', positions: positions(900) })
  map.set('3', { id: '3', class: 'person', team: 'team_b', color: '#2563EB', positions: positions(1150) })
  map.set('ball', {
    id: 'ball', class: 'ball', team: 'ball', color: '#F8FAFC',
    positions: Array.from({ length: 60 }, (_, f) => ({ frame: f, x: f < 30 ? 215 : 915, y: 330, w: 14, h: 14, score: 0.5 })),
  })
  const derived = deriveAnalytics(map, { frame_id: 59, resolution: [1280, 720] }, 30)
  check('possession transfers across a long pass', derived.passes.total_passes >= 1, String(derived.passes.total_passes))
  check('the pass is credited to the right team', derived.passes.team_a_passes >= 1, String(derived.passes.team_a_passes))
}

// ------------------------------------------------------ tracker identity
console.log('\n[tracker identity]')
{
  const tracker = new MultiObjectTracker()
  // Two detections on the same player: one solid, one a near-duplicate from a
  // tile seam. Only one track should survive.
  for (let f = 0; f < 12; f++) {
    tracker.update([
      { bbox: [300 + f * 2, 200, 40, 92], score: 0.9, class: 'person' },
      { bbox: [304 + f * 2, 204, 38, 88], score: 0.6, class: 'person' },
      { bbox: [700, 300, 40, 92], score: 0.9, class: 'person' },
    ])
  }
  const live = tracker.snapshot().filter((t) => t.class === 'person')
  check('overlapping tracks on one player are merged', live.length === 2, `${live.length} tracks`)

  // Labels must stay small and readable even after churn.
  for (let round = 0; round < 40; round++) {
    tracker.update([{ bbox: [100 + (round % 5) * 300, 150 + (round % 3) * 120, 40, 92], score: 0.9, class: 'person' }])
  }
  const labels = tracker.snapshot().map((t) => t.label)
  const ids = tracker.snapshot().map((t) => t.id)
  check('display labels stay in a readable range', labels.every((l) => l >= 1 && l <= 30), labels.join(','))
  check('internal ids have climbed well past the labels', Math.max(...ids) > Math.max(...labels), `ids max ${Math.max(...ids)} vs labels max ${Math.max(...labels)}`)
  check('labels are unique among live tracks', new Set(labels).size === labels.length, labels.join(','))
}

// ------------------------------------------------------- pass success rate
console.log('\n[pass outcomes]')
function passScenario(interceptDistance: number) {
  const map = new Map<string, any>()
  const still = (x: number) => Array.from({ length: 90 }, (_, f) => ({ frame: f, x, y: 300, w: 40, h: 90, score: 0.9 }))
  map.set('1', { id: '1', class: 'person', team: 'team_a', color: '#E11D48', positions: still(200) })
  map.set('2', { id: '2', class: 'person', team: 'team_a', color: '#E11D48', positions: still(500) })
  map.set('3', { id: '3', class: 'person', team: 'team_b', color: '#2563EB', positions: still(500 + interceptDistance) })
  map.set('ball', {
    id: 'ball', class: 'ball', team: 'ball', color: '#F8FAFC',
    positions: Array.from({ length: 90 }, (_, f) => ({
      // A completed pass 1 -> 2, then the ball is lost to team B.
      frame: f, x: f < 30 ? 215 : f < 60 ? 515 : 515 + interceptDistance,
      y: 330, w: 14, h: 14, score: 0.5,
    })),
  })
  return deriveAnalytics(map, { frame_id: 89, resolution: [1280, 720] }, 30)
}
{
  const derived = passScenario(300) // ball travels: an interception
  const p = derived.passes
  check('attempts include the lost ball', p.total_passes >= 2, String(p.total_passes))
  check('completions are fewer than attempts', p.successful_passes < p.total_passes, `${p.successful_passes}/${p.total_passes}`)
  check(
    'success rate is a real percentage, not 0 or 100',
    p.pass_success_rate > 0 && p.pass_success_rate < 100,
    `${p.pass_success_rate.toFixed(1)}%`,
  )
  check('rate equals completed over attempted', Math.abs(p.pass_success_rate - (p.successful_passes / p.total_passes) * 100) < 0.01, '')
  check('an unsuccessful pass is recorded', p.recent_passes.some((x) => !x.successful), '')
  check('an interception event is on the timeline', derived.events.some((e) => /Interception/.test(e.label)), '')
}
{
  const derived = passScenario(45) // ball barely moves: a tackle, not a pass
  const p = derived.passes
  check('a close-range loss is not counted as a pass attempt', p.recent_passes.every((x) => x.successful), `${p.successful_passes}/${p.total_passes}`)
  check('it still registers as a turnover', derived.events.some((e) => e.type === 'turnover'), '')
}

// ------------------------------------------------------------ pitch bounds
console.log('\n[pitch boundary]')
{
  // Grass across the lower half, stands and boards above it.
  const w = 320, h = 200
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const onPitch = y >= h / 2
      data[i] = onPitch ? 46 : 120
      data[i + 1] = onPitch ? 125 : 110
      data[i + 2] = onPitch ? 50 : 115
      data[i + 3] = 255
    }
  }
  const pitch = computePitchMask({ width: w, height: h, data, colorSpace: 'srgb' } as ImageData)
  check('pitch is detected as reliable', pitch.reliable, `coverage ${pitch.coverage.toFixed(2)}`)
  check('boundary sits near the halfway line', Math.abs(pitch.horizon[160] - h / 2) < 14, String(pitch.horizon[160]))

  // A player standing on the grass.
  check('a player on the pitch is kept', isPlayerOnPitch([150, 120, 20, 60], pitch), '')
  // A camera operator behind the boards: feet well above the boundary.
  check('a camera operator behind the boards is rejected', !isPlayerOnPitch([150, 20, 20, 55], pitch), '')
  // Crowd high in the stands.
  check('the crowd is rejected', !isPlayerOnPitch([40, 5, 16, 40], pitch), '')
}
{
  // A tight close-up with almost no grass: filtering must switch itself off
  // rather than discard every detection.
  const w = 160, h = 120
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) { data[i] = 130; data[i+1] = 120; data[i+2] = 125; data[i+3] = 255 }
  const pitch = computePitchMask({ width: w, height: h, data, colorSpace: 'srgb' } as ImageData)
  check('a close-up is marked unreliable', !pitch.reliable, `coverage ${pitch.coverage.toFixed(2)}`)
  check('unreliable pitch keeps detections', isPlayerOnPitch([40, 10, 20, 50], pitch), '')
}

// ------------------------------------------------ direction of play & units
console.log('\n[team shape]')
function shapeScenario(teamAOnLeft: boolean) {
  const map = new Map<string, any>()
  const add = (id: string, team: string, x: number, y: number) => {
    map.set(id, {
      id, class: 'person', team, color: team === 'team_a' ? '#E11D48' : '#2563EB',
      positions: Array.from({ length: 40 }, (_, f) => ({ frame: f, x, y, w: 40, h: 90, score: 0.9 })),
    })
  }
  // Deep block of 4 on one side, an advanced 3 pushed high on the other.
  const deepX = teamAOnLeft ? 150 : 1050
  const highX = teamAOnLeft ? 1050 : 150
  for (let i = 0; i < 4; i++) add(`a${i}`, 'team_a', deepX + i * 20, 200 + i * 90)
  for (let i = 0; i < 3; i++) add(`b${i}`, 'team_b', highX + i * 20, 250 + i * 90)
  return deriveAnalytics(map, { frame_id: 39, resolution: [1280, 720] }, 30)
}
{
  const left = shapeScenario(true)
  const right = shapeScenario(false)
  check('team A defending the left is detected', left.team.aDefendsLowX, String(left.team.aDefendsLowX))
  check('team A defending the right is detected', !right.team.aDefendsLowX, String(right.team.aDefendsLowX))
  // Mirroring the pitch must mirror the reading, not change it.
  check(
    'attacking-third share is direction independent',
    Math.abs(left.extras.attackingThirdA - right.extras.attackingThirdA) < 0.01,
    `${left.extras.attackingThirdA} vs ${right.extras.attackingThirdA}`,
  )
  check(
    'formation is direction independent',
    left.team.teamA.name === right.team.teamA.name,
    `${left.team.teamA.name} vs ${right.team.teamA.name}`,
  )
}
{
  const derived = shapeScenario(true)
  check('team width is reported in metres', derived.team.teamA.widthM > 0 && derived.team.teamA.widthM < 120, derived.team.teamA.widthM.toFixed(1))
  check('team separation is reported in metres', derived.team.separationM > 0 && derived.team.separationM < 150, derived.team.separationM.toFixed(1))
  check('compactness is a plausible area in m2', derived.extras.compactnessA >= 0 && derived.extras.compactnessA < 12000, String(derived.extras.compactnessA))
}

// -------------------------------------------------------- perspective scale
console.log('\n[perspective]')
{
  // Players receding up the frame: near ones tall, far ones short. Two pairs
  // separated by the same pixel gap must not measure the same in metres.
  const map = new Map<string, any>()
  const add = (id: string, x: number, footY: number, h: number) => {
    map.set(id, {
      id, class: 'person', team: Number(id) % 2 ? 'team_a' : 'team_b',
      color: Number(id) % 2 ? '#E11D48' : '#2563EB',
      positions: Array.from({ length: 30 }, (_, f) => ({ frame: f, x, y: footY - h, w: h / 2.2, h, score: 0.9 })),
    })
  }
  // Foot row 120 -> 40px tall (far); foot row 640 -> 160px tall (near).
  for (let i = 0; i < 6; i++) add(String(i), 200 + i * 120, 120 + i * 104, 40 + i * 24)
  const derived = deriveAnalytics(map, { frame_id: 29, resolution: [1280, 720] }, 30)

  const scaleFar = derived.extras.metersPerPixel
  check('a scale is produced', scaleFar > 0, String(scaleFar))
  // A team spanning most of the frame must not read as a handful of metres.
  const spread = Math.max(derived.team.teamA.widthM, derived.team.teamB.widthM)
  check('team width across the frame is tens of metres', spread > 8, `${spread.toFixed(1)} m`)
  check('team width stays physically plausible', spread < 120, `${spread.toFixed(1)} m`)
}
{
  // Same pixel distance, different depths: the far pair covers more ground.
  const near = new Map<string, any>()
  const far = new Map<string, any>()
  const build = (map: Map<string, any>, footY: number, h: number) => {
    for (let i = 0; i < 8; i++) {
      map.set(String(i), {
        id: String(i), class: 'person', team: i % 2 ? 'team_a' : 'team_b',
        color: i % 2 ? '#E11D48' : '#2563EB',
        positions: Array.from({ length: 30 }, (_, f) => ({
          frame: f, x: 300 + (i % 2) * 200, y: footY - h + i * 6, w: h / 2.2, h, score: 0.9,
        })),
      })
    }
  }
  build(near, 660, 170)
  build(far, 200, 45)
  const dNear = deriveAnalytics(near, { frame_id: 29, resolution: [1280, 720] }, 30)
  const dFar = deriveAnalytics(far, { frame_id: 29, resolution: [1280, 720] }, 30)
  check(
    'the same pixel gap measures larger when further away',
    dFar.team.separationM > dNear.team.separationM,
    `far ${dFar.team.separationM.toFixed(1)} m vs near ${dNear.team.separationM.toFixed(1)} m`,
  )
}

// ------------------------------------------------------------- heatmaps
console.log('\n[heatmaps]')
{
  // One player pacing a tiny patch. Normalised to its own extent this filled
  // the whole grid, reading as if the player had covered the pitch.
  const map = new Map<string, any>()
  const still = Array.from({ length: 60 }, (_, f) => ({
    frame: f, x: 600 + (f % 3), y: 400 + (f % 2), w: 40, h: 90, score: 0.9,
  }))
  map.set('1', { id: '1', class: 'person', team: 'team_a', color: '#E11D48', positions: still })
  for (let i = 0; i < 4; i++) {
    map.set(String(10 + i), {
      id: String(10 + i), class: 'person', team: i % 2 ? 'team_b' : 'team_a',
      color: i % 2 ? '#2563EB' : '#E11D48',
      positions: Array.from({ length: 60 }, (_, f) => ({
        frame: f, x: 80 + i * 40 + f * 18, y: 150 + i * 60 + f * 6, w: 40, h: 90, score: 0.9,
      })),
    })
  }
  const derived = deriveAnalytics(map, { frame_id: 59, resolution: [1280, 720] }, 30)
  const extent = derived.heatmaps.extent
  check('extent comes from the frame, not the points', extent.maxX === 1280 && extent.maxY === 720, JSON.stringify(extent))
  check('extent starts at the frame origin', extent.minX === 0 && extent.minY === 0, JSON.stringify(extent))

  // Bin the stationary player the way the grid does, and confirm he lands in
  // one or two cells rather than spread across the whole thing.
  const COLS = 12, ROWS = 8
  const pacer = derived.heatmaps.players.find((p) => p.id === '1')!
  const cells = new Set<number>()
  for (const point of pacer.points) {
    const col = Math.min(COLS - 1, Math.floor(((point.x - extent.minX) / (extent.maxX - extent.minX)) * COLS))
    const row = Math.min(ROWS - 1, Math.floor(((point.y - extent.minY) / (extent.maxY - extent.minY)) * ROWS))
    cells.add(row * COLS + col)
  }
  check('a stationary player occupies very few cells', cells.size <= 2, `${cells.size} of ${COLS * ROWS}`)

  const mover = derived.heatmaps.players.find((p) => p.id === '10')!
  const moverCells = new Set<number>()
  for (const point of mover.points) {
    const col = Math.min(COLS - 1, Math.floor(((point.x - extent.minX) / (extent.maxX - extent.minX)) * COLS))
    const row = Math.min(ROWS - 1, Math.floor(((point.y - extent.minY) / (extent.maxY - extent.minY)) * ROWS))
    moverCells.add(row * COLS + col)
  }
  check('a player who ranges covers more cells than one who does not', moverCells.size > cells.size, `${moverCells.size} vs ${cells.size}`)
  // A box centred on the touchline can sit a few pixels outside the frame, so
  // the grid must clamp rather than assume every point is in range.
  const bin = (pt: { x: number; y: number }) => {
    const col = Math.min(COLS - 1, Math.max(0, Math.floor(((pt.x - extent.minX) / (extent.maxX - extent.minX)) * COLS)))
    const row = Math.min(ROWS - 1, Math.max(0, Math.floor(((pt.y - extent.minY) / (extent.maxY - extent.minY)) * ROWS)))
    return row * COLS + col
  }
  const allPoints = derived.heatmaps.players.flatMap((p) => p.points)
  check(
    'every point bins to a valid cell, including ones off the frame edge',
    allPoints.every((pt) => { const i = bin(pt); return Number.isInteger(i) && i >= 0 && i < COLS * ROWS }),
    '',
  )
}

// ------------------------------------------------ physical plausibility
console.log('\n[plausibility]')
{
  // A track that teleports mid-clip, as happens when the tracker swaps two
  // players. The jump must not become distance covered or a peak speed.
  const map = new Map<string, any>()
  const positions = []
  for (let f = 0; f < 60; f++) {
    // Walks slowly, then jumps the width of the pitch at frame 30.
    const x = f < 30 ? 300 + f * 2 : 1100 + (f - 30) * 2
    positions.push({ frame: f, x, y: 500, w: 40, h: 100, score: 0.9 })
  }
  map.set('1', { id: '1', class: 'person', team: 'team_a', color: '#E11D48', positions })
  for (let i = 0; i < 5; i++) {
    map.set(String(20 + i), {
      id: String(20 + i), class: 'person', team: i % 2 ? 'team_b' : 'team_a',
      color: i % 2 ? '#2563EB' : '#E11D48',
      positions: Array.from({ length: 60 }, (_, f) => ({
        frame: f, x: 200 + i * 180 + f, y: 300 + i * 70, w: 40, h: 60 + i * 18, score: 0.9,
      })),
    })
  }
  const derived = deriveAnalytics(map, { frame_id: 59, resolution: [1280, 720] }, 30)
  const jumper = derived.players.find((p) => p.id === '1')!

  check('peak speed stays humanly possible', jumper.maxSpeedM <= 12, `${jumper.maxSpeedM.toFixed(1)} m/s`)
  check('the teleport is not counted as distance', jumper.distanceM < 60, `${jumper.distanceM.toFixed(1)} m`)
  check(
    'average speed is plausible for a footballer',
    jumper.avgSpeedM >= 0 && jumper.avgSpeedM <= 12,
    `${jumper.avgSpeedM.toFixed(1)} m/s`,
  )
  check(
    'no player reports an impossible peak',
    derived.players.every((p) => p.maxSpeedM <= 12 && Number.isFinite(p.maxSpeedM)),
    derived.players.map((p) => p.maxSpeedM.toFixed(1)).join(','),
  )
  check(
    'every distance is finite and non-negative',
    derived.players.every((p) => Number.isFinite(p.distanceM) && p.distanceM >= 0),
    '',
  )
}
{
  // Fewer than five tracked players cannot yield a formation.
  const map = new Map<string, any>()
  for (let i = 0; i < 3; i++) {
    map.set(String(i), {
      id: String(i), class: 'person', team: 'team_a', color: '#E11D48',
      positions: Array.from({ length: 30 }, (_, f) => ({ frame: f, x: 300 + i * 100, y: 400, w: 40, h: 90, score: 0.9 })),
    })
  }
  const derived = deriveAnalytics(map, { frame_id: 29, resolution: [1280, 720] }, 30)
  check(
    'a formation is never faked from too few players',
    !/^\d+ players$/.test(derived.team.teamA.name),
    derived.team.teamA.name,
  )
}

// ------------------------------------------- audit regressions
console.log('\n[audit fixes]')
{
  // Replaying a clip rewinds the frame ids. Distance used to keep accumulating
  // while elapsed time stayed pinned to the media-time span.
  const map = new Map<string, any>()
  const pass1 = Array.from({ length: 40 }, (_, f) => ({ frame: f * 3, x: 300 + f * 4, y: 500, w: 40, h: 100, score: 0.9 }))
  const pass2 = Array.from({ length: 40 }, (_, f) => ({ frame: f * 3, x: 300 + f * 4, y: 500, w: 40, h: 100, score: 0.9 }))
  map.set('1', { id: '1', class: 'person', team: 'team_a', color: '#E11D48', positions: [...pass1, ...pass2] })
  for (let i = 0; i < 5; i++) {
    map.set(String(20 + i), {
      id: String(20 + i), class: 'person', team: i % 2 ? 'team_b' : 'team_a', color: i % 2 ? '#2563EB' : '#E11D48',
      positions: Array.from({ length: 40 }, (_, f) => ({ frame: f * 3, x: 200 + i * 200 + f * 3, y: 250 + i * 80, w: 40, h: 55 + i * 20, score: 0.9 })),
    })
  }
  const d = deriveAnalytics(map, { frame_id: 117, resolution: [1280, 720] }, 30)
  const replayed = d.players.find((p) => p.id === '1')!
  check('replayed footage does not inflate average speed', replayed.avgSpeedM <= 12, `${replayed.avgSpeedM.toFixed(2)} m/s`)
  check('elapsed time is never zero while distance accrues',
    replayed.distanceM === 0 || replayed.timeOnField > 0, `${replayed.timeOnField.toFixed(1)}s / ${replayed.distanceM.toFixed(1)}m`)
  // Replaying observes the player a second time, so distance and elapsed time
  // both grow. What must not change is the speed derived from them - that is
  // the invariant the old frame-span formula broke.
  const single = new Map<string, any>(map)
  single.set('1', { ...map.get('1'), positions: pass1 })
  const solo = deriveAnalytics(single, { frame_id: 117, resolution: [1280, 720] }, 30).players.find((p) => p.id === '1')!
  check(
    'replaying a clip leaves average speed unchanged',
    Math.abs(replayed.avgSpeedM - solo.avgSpeedM) < 0.05,
    `replayed ${replayed.avgSpeedM.toFixed(2)} vs single ${solo.avgSpeedM.toFixed(2)} m/s`,
  )
  check(
    'elapsed time grows with the footage actually observed',
    replayed.timeOnField > solo.timeOnField * 1.5,
    `${replayed.timeOnField.toFixed(2)}s vs ${solo.timeOnField.toFixed(2)}s`,
  )
}
{
  // buildPitchScale used to spread one argument per position into Math.min/max.
  const map = new Map<string, any>()
  for (let i = 0; i < 6; i++) {
    map.set(String(i), {
      id: String(i), class: 'person', team: i % 2 ? 'team_b' : 'team_a', color: i % 2 ? '#2563EB' : '#E11D48',
      positions: Array.from({ length: 30000 }, (_, f) => ({ frame: f, x: 200 + (f % 700), y: 200 + i * 70, w: 40, h: 60 + i * 15, score: 0.9 })),
    })
  }
  let threw = ''
  try { deriveAnalytics(map, { frame_id: 29999, resolution: [1280, 720] }, 30) }
  catch (err) { threw = (err as Error).message }
  check('180k tracked positions do not overflow the stack', threw === '', threw)
}
{
  // Pass distance is stored in metres; the view used to scale it a second time.
  const map = new Map<string, any>()
  const still = (x: number) => Array.from({ length: 60 }, (_, f) => ({ frame: f, x, y: 400, w: 40, h: 90, score: 0.9 }))
  map.set('1', { id: '1', class: 'person', team: 'team_a', color: '#E11D48', positions: still(200) })
  map.set('2', { id: '2', class: 'person', team: 'team_a', color: '#E11D48', positions: still(700) })
  map.set('3', { id: '3', class: 'person', team: 'team_b', color: '#2563EB', positions: still(760) })
  map.set('ball', { id: 'ball', class: 'ball', team: 'ball', color: '#F8FAFC',
    positions: Array.from({ length: 60 }, (_, f) => ({ frame: f, x: f < 30 ? 215 : 715, y: 430, w: 14, h: 14, score: 0.5 })) })
  const d = deriveAnalytics(map, { frame_id: 59, resolution: [1280, 720] }, 30)
  const p = d.passes.recent_passes[0]
  check('a pass across the pitch is metres, not centimetres', !p || p.distance >= 3, p ? `${p.distance.toFixed(1)} m` : 'no pass')
}

// ------------------------------------------------- loose ball / attribution
console.log('\n[possession attribution]')
{
  // A ball tracked far from everyone: in flight, or a stray detection. It must
  // not hand possession to whoever happens to be least far away.
  const map = new Map<string, any>()
  const still = (id: string, team: string, x: number, y: number) => map.set(id, {
    id, class: 'person', team, color: team === 'team_a' ? '#E11D48' : '#2563EB',
    positions: Array.from({ length: 60 }, (_, f) => ({ frame: f, x, y, w: 40, h: 90, score: 0.9 })),
  })
  still('1', 'team_a', 200, 400); still('2', 'team_a', 260, 430)
  still('3', 'team_b', 320, 410); still('4', 'team_b', 380, 440)
  map.set('ball', { id: 'ball', class: 'ball', team: 'ball', color: '#F8FAFC',
    positions: Array.from({ length: 60 }, (_, f) => ({ frame: f, x: 1150, y: 120, w: 14, h: 14, score: 0.5 })) })
  const d = deriveAnalytics(map, { frame_id: 59, resolution: [1280, 720] }, 30)
  check('a ball nobody is near grants no possession',
    d.possession.total_possession_time < 1.5, `${d.possession.total_possession_time.toFixed(1)}s`)
}
{
  // Ball genuinely at a team_a player's feet the whole time.
  const map = new Map<string, any>()
  const still = (id: string, team: string, x: number) => map.set(id, {
    id, class: 'person', team, color: team === 'team_a' ? '#E11D48' : '#2563EB',
    positions: Array.from({ length: 60 }, (_, f) => ({ frame: f, x, y: 400, w: 40, h: 90, score: 0.9 })),
  })
  still('1', 'team_a', 300); still('2', 'team_a', 380)
  still('3', 'team_b', 700); still('4', 'team_b', 780)
  map.set('ball', { id: 'ball', class: 'ball', team: 'ball', color: '#F8FAFC',
    positions: Array.from({ length: 60 }, (_, f) => ({ frame: f, x: 315, y: 460, w: 14, h: 14, score: 0.5 })) })
  const d = deriveAnalytics(map, { frame_id: 59, resolution: [1280, 720] }, 30)
  check('a ball at a player\'s feet does grant possession', d.possession.total_possession_time > 1, `${d.possession.total_possession_time.toFixed(1)}s`)
  check('ball coverage never exceeds one', d.ballCoverage <= 1.0001, d.ballCoverage.toFixed(2))
}
{
  // One side barely tracked: a split would describe the camera, not the match.
  const map = new Map<string, any>()
  for (let i = 0; i < 5; i++) {
    map.set(String(i), { id: String(i), class: 'person', team: 'team_a', color: '#E11D48',
      positions: Array.from({ length: 60 }, (_, f) => ({ frame: f, x: 300 + i * 60, y: 400, w: 40, h: 90, score: 0.9 })) })
  }
  map.set('lone', { id: 'lone', class: 'person', team: 'team_b', color: '#2563EB',
    positions: Array.from({ length: 3 }, (_, f) => ({ frame: f, x: 900, y: 400, w: 40, h: 90, score: 0.9 })) })
  const d = deriveAnalytics(map, { frame_id: 59, resolution: [1280, 720] }, 30)
  check('a one-sided view is flagged as not attributable', !d.possessionAttributable, String(d.possessionAttributable))
}

// --------------------------------------------------- win probability model
console.log('\n[win probability]')
{
  const dominant = computeWinProbability({
    possessionA: 80, possessionB: 20, possessionTime: 12,
    attackingA: 70, attackingB: 10, teamAPasses: 15, teamBPasses: 3,
    ballX: 1100, fieldWidth: 1280, hasPeople: true,
  })
  check('dominant team is favoured', dominant.team_a > 70, `${dominant.team_a}%`)
  check('probabilities sum to 100', Math.abs(dominant.team_a + dominant.team_b - 100) < 0.2, `${dominant.team_a}+${dominant.team_b}`)
  check('factors are returned', dominant.factors.length >= 3, String(dominant.factors.length))
  check('factors are ranked by influence', dominant.factors.every((f, i, a) => i === 0 || Math.abs(a[i - 1].contribution) >= Math.abs(f.contribution)), '')
  check('every factor carries an explanation', dominant.factors.every((f) => f.detail.length > 0), '')

  const mirrored = computeWinProbability({
    possessionA: 20, possessionB: 80, possessionTime: 12,
    attackingA: 10, attackingB: 70, teamAPasses: 3, teamBPasses: 15,
    ballX: 180, fieldWidth: 1280, hasPeople: true,
  })
  check('model is symmetric', Math.abs(mirrored.team_b - dominant.team_a) < 0.2, `${mirrored.team_b} vs ${dominant.team_a}`)

  const neutral = computeWinProbability({ hasPeople: false, possessionTime: 0 })
  check('pre-match is 50/50', neutral.team_a === 50 && neutral.team_b === 50, `${neutral.team_a}/${neutral.team_b}`)

  const momentum = computeWinProbability({
    possessionA: 50, possessionB: 50, possessionTime: 10,
    recentPossessionA: 90, hasPeople: true,
  })
  check('momentum shifts an even game', momentum.team_a > 52, `${momentum.team_a}%`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
