export type TeamId = 'team_a' | 'team_b' | 'ball' | 'unknown'

export const DEFAULT_TEAM_COLORS = {
  team_a: '#E11D48',
  team_b: '#2563EB',
  ball: '#F8FAFC',
  unknown: '#6B7280',
}

export function hexToRgb(hex?: string | null) {
  const value = (hex || '').replace('#', '')
  if (value.length < 6) return { r: 107, g: 114, b: 128 }
  return {
    r: parseInt(value.slice(0, 2), 16) || 0,
    g: parseInt(value.slice(2, 4), 16) || 0,
    b: parseInt(value.slice(4, 6), 16) || 0,
  }
}

export function rgbaFromHex(hex: string, alpha = 0.14) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function rgbTuple(hex: string) {
  const { r, g, b } = hexToRgb(hex)
  return `${r}, ${g}, ${b}`
}

/**
 * Names a kit colour the way a commentator would.
 *
 * Hue decides the name whenever there is any hue at all: kit samples averaged
 * off a video are muted, so a saturation-first test labels most real kits
 * "Grey". Only genuinely neutral colours fall through to black/white/grey.
 */
export function colorName(hex?: string | null) {
  if (!hex) return 'Unknown'
  const { r, g, b } = hexToRgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  if (chroma < 14) {
    if (max < 60) return 'Black'
    if (min > 200) return 'White'
    return 'Grey'
  }

  let hue: number
  if (max === r) hue = ((g - b) / chroma) * 60
  else if (max === g) hue = ((b - r) / chroma + 2) * 60
  else hue = ((r - g) / chroma + 4) * 60
  if (hue < 0) hue += 360

  if (hue < 16 || hue >= 336) return 'Red'
  if (hue < 42) return 'Orange'
  if (hue < 70) return 'Yellow'
  if (hue < 160) return 'Green'
  if (hue < 200) return 'Teal'
  if (hue < 250) return 'Blue'
  if (hue < 290) return 'Purple'
  return 'Pink'
}

export interface TrackPosition {
  frame: number
  x: number
  y: number
  w: number
  h: number
  score: number
}

export interface NormalizedTrack {
  id: string
  class: string
  team: TeamId
  jersey?: number | null
  color?: string
  positions: TrackPosition[]
}

export interface PlayerMetric {
  id: string
  team: TeamId
  jersey?: number | null
  color?: string
  frames: number
  timeOnField: number
  distancePx: number
  distanceM: number
  avgSpeed: number
  maxSpeed: number
  avgSpeedM: number
  maxSpeedM: number
  sprints: number
  lastPosition: TrackPosition | null
}

export interface PassEvent {
  from_player: string
  to_player: string
  successful: boolean
  timestamp: number
  distance: number
  team: string
  frame?: number
}

export type PossessionSource = 'ball' | 'proximity' | 'worker' | 'none'

export interface MatchEvent {
  id: string
  type: 'pass' | 'turnover' | 'sprint' | 'control'
  frame: number
  time: number
  team: TeamId
  label: string
  detail: string
}

export interface TeamShapeSummary {
  name: string
  count: number
  /** Lateral spread in pixels; widthM is the same figure in metres. */
  width: number
  depth: number
  widthM: number
  depthM: number
  center: { x: number; y: number }
}

export interface DerivedAnalytics {
  ready: boolean
  events: MatchEvent[]
  emptyReason: string
  ballDetected: boolean
  /** Share of possession samples that were anchored on a tracked ball, 0..1. */
  ballCoverage: number
  playerCount: number
  objectCount: number
  frameId: number
  fps: number
  players: PlayerMetric[]
  possession: {
    team_a_possession: number
    team_b_possession: number
    team_a_percentage: number
    team_b_percentage: number
    total_possession_time: number
    possession_events: number
    passes: number
    current_possession: { player_id: string; team: string } | null
    source: PossessionSource
  }
  passes: {
    total_passes: number
    successful_passes: number
    pass_success_rate: number
    team_a_passes: number
    team_b_passes: number
    recent_passes: PassEvent[]
    top_passers: Array<{ player: string; passes: number }>
    top_recipients: Array<{ player: string; receptions: number }>
    pass_matrix: Array<{ from: string; to: string; count: number }>
    source: PossessionSource
  }
  team: {
    teamA: TeamShapeSummary
    teamB: TeamShapeSummary
    separation: number
    /** Distance between team centroids, in metres. */
    separationM: number
    /** True when team A is the side defending the low-x end of the frame. */
    aDefendsLowX: boolean
  }
  teamColors: { team_a: string; team_b: string }
  teamLabels: { team_a: string; team_b: string }
  extras: {
    sprints: number
    /** Area of each team's bounding box, in square metres. */
    compactnessA: number
    compactnessB: number
    attackingThirdA: number
    attackingThirdB: number
    metersPerPixel: number
    winA: number
    winB: number
    winConfidence: 'high' | 'live'
    winReason: string
    winFactors: WinFactor[]
  }
  heatmaps: {
    /**
     * Shared coordinate frame for every heatmap, in source-video pixels.
     * Without one, each grid rescales to its own points and a player who barely
     * moved fills the pitch exactly like one who covered it.
     */
    extent: { minX: number; minY: number; maxX: number; maxY: number }
    players: Array<{
      id: string
      team: TeamId
      points: Array<{ x: number; y: number; intensity: number }>
      timeOnField: number
    }>
    teams: Array<{
      team: TeamId
      points: Array<{ x: number; y: number; intensity: number }>
    }>
  }
}

function isPerson(track: { class?: string }) {
  return track.class !== 'ball'
}

function center(pos: TrackPosition) {
  return { x: pos.x + (pos.w || 0) / 2, y: pos.y + (pos.h || 0) / 2 }
}

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function mean(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function hasAssignedTeam(team?: string): team is 'team_a' | 'team_b' {
  return team === 'team_a' || team === 'team_b'
}

export function collectTracks(
  tracks: Map<string, any>,
  trackingData?: any[],
  frameId = 0,
): NormalizedTrack[] {
  const byId = new Map<string, NormalizedTrack>()

  tracks.forEach((track, id) => {
    byId.set(String(id), {
      id: String(id),
      class: track.class || 'person',
      team: (track.team as TeamId) || 'unknown',
      jersey: track.jersey ?? null,
      color: track.color,
      positions: Array.isArray(track.positions) ? track.positions : [],
    })
  })

  if (trackingData?.length) {
    trackingData.forEach((obj) => {
      const id = String(obj.track_id ?? obj.id)
      const existing = byId.get(id) || {
        id,
        class: obj.class || 'person',
        team: (obj.team as TeamId) || 'unknown',
        jersey: null,
        color: obj.color,
        positions: [],
      }
      if (obj.color) existing.color = obj.color
      if (obj.team) existing.team = obj.team
      const bbox = obj.bbox || obj.center || [0, 0, 0, 0]
      const nextPos: TrackPosition = {
        frame: frameId,
        x: Number(bbox[0]) || 0,
        y: Number(bbox[1]) || 0,
        w: Number(bbox[2]) || 0,
        h: Number(bbox[3]) || 0,
        score: Number(obj.confidence ?? obj.score ?? 0),
      }
      const last = existing.positions[existing.positions.length - 1]
      if (!last || last.frame !== nextPos.frame) {
        existing.positions = [...existing.positions, nextPos]
      }
      if (!existing.class && obj.class) existing.class = obj.class
      byId.set(id, existing)
    })
  }

  return Array.from(byId.values())
}

export function assignTeams(tracks: NormalizedTrack[]): NormalizedTrack[] {
  const withColor = tracks.filter((track) => isPerson(track) && track.color && hasAssignedTeam(track.team))
  if (withColor.length >= Math.max(4, tracks.filter(isPerson).length * 0.4)) {
    return tracks.map((track) => (track.class === 'ball' ? { ...track, team: 'ball' } : track))
  }

  const players = tracks.filter((track) => isPerson(track) && track.positions.length > 0)
  let teamById = new Map<string, TeamId>()
  if (players.length >= 2) {
    const averages = players.map((track) => {
      const xs = track.positions.map((pos) => center(pos).x)
      return { id: track.id, avgX: mean(xs) }
    })
    const split = median(averages.map((item) => item.avgX))
    averages.forEach((item) => {
      teamById.set(item.id, item.avgX < split ? 'team_a' : 'team_b')
    })
  }

  return tracks.map((track) => {
    let next = track
    if (track.class === 'ball') {
      next = { ...track, team: 'ball', color: track.color || DEFAULT_TEAM_COLORS.ball }
    } else if (!(hasAssignedTeam(track.team) && track.color)) {
      next = { ...track, team: teamById.get(track.id) || track.team || 'unknown' }
    }
    if (!next.color && (next.team === 'team_a' || next.team === 'team_b')) {
      next = { ...next, color: DEFAULT_TEAM_COLORS[next.team] }
    }
    return next
  })
}

function keepActiveTracks(tracks: NormalizedTrack[], minFrames = 5, maxPeople = 24) {
  let people = tracks
    .filter((track) => isPerson(track) && track.positions.length >= minFrames)
    .sort((a, b) => b.positions.length - a.positions.length)
  if (people.length < 4) {
    people = tracks
      .filter((track) => isPerson(track) && track.positions.length >= 2)
      .sort((a, b) => b.positions.length - a.positions.length)
  }
  const balls = tracks.filter((track) => track.class === 'ball' && track.positions.length > 0)
  return [...people.slice(0, maxPeople), ...balls]
}

export interface WinFactor {
  label: string
  /** Signed contribution to the log-odds; positive favours team A. */
  contribution: number
  detail: string
}

/**
 * Live win-probability estimate.
 *
 * A logistic blend of the signals the vision pipeline can actually observe.
 * Each contribution is returned alongside the result, because a single
 * percentage with no reasoning is not something a coach can act on — and it
 * makes the model auditable when a number looks wrong.
 */
export function computeWinProbability(input: {
  possessionA?: number
  possessionB?: number
  possessionTime?: number
  attackingA?: number
  attackingB?: number
  teamAPasses?: number
  teamBPasses?: number
  ballX?: number | null
  fieldWidth?: number
  meanTeamAX?: number | null
  meanTeamBX?: number | null
  hasPeople?: boolean
  /** Possession split over the most recent window, for momentum. */
  recentPossessionA?: number | null
}) {
  const possA = Number(input.possessionA || 0)
  const possB = Number(input.possessionB || 0)
  const possTime = Number(input.possessionTime || 0)
  const attackingA = Number(input.attackingA || 0)
  const attackingB = Number(input.attackingB || 0)
  const teamAPasses = Number(input.teamAPasses || 0)
  const teamBPasses = Number(input.teamBPasses || 0)
  const width = Math.max(Number(input.fieldWidth || 1280), 1)
  const factors: WinFactor[] = []
  let logit = 0

  const add = (label: string, contribution: number, detail: string) => {
    if (!contribution) return
    logit += contribution
    factors.push({ label, contribution, detail })
  }

  if (possTime >= 0.35 && possA + possB > 0) {
    add('Possession', ((possA - possB) / 100) * 1.15, `${possA.toFixed(0)}% vs ${possB.toFixed(0)}%`)
  }
  if (attackingA || attackingB) {
    add(
      'Field tilt',
      ((attackingA - attackingB) / 100) * 0.75,
      `${attackingA.toFixed(0)}% vs ${attackingB.toFixed(0)}% in the attacking third`,
    )
  }
  const totalPasses = teamAPasses + teamBPasses
  if (totalPasses) {
    add('Passing', ((teamAPasses - teamBPasses) / totalPasses) * 0.28, `${teamAPasses} vs ${teamBPasses} passes`)
  }
  if (input.ballX != null && Number.isFinite(input.ballX)) {
    const tilt = Math.max(-1, Math.min(1, (input.ballX / width - 0.5) * 2))
    add('Ball location', tilt * 0.5, tilt > 0 ? 'Ball in team B territory' : 'Ball in team A territory')
  } else if (input.meanTeamAX != null && input.meanTeamBX != null) {
    const tilt = Math.max(-0.6, Math.min(0.6, (input.meanTeamAX - input.meanTeamBX) / width))
    add('Team shape', tilt * 0.35, 'Estimated from relative team positions')
  }
  // Momentum: who has been on the ball most recently, not across the whole clip.
  if (input.recentPossessionA != null && possTime >= 2) {
    const swing = (input.recentPossessionA - possA) / 100
    add('Momentum', Math.max(-0.4, Math.min(0.4, swing * 0.9)), swing > 0 ? 'Team A rising' : 'Team B rising')
  }

  let winA = Math.round((1 / (1 + Math.exp(-logit))) * 1000) / 10
  let winB = Math.round((100 - winA) * 10) / 10
  if (!input.hasPeople && possTime <= 0) {
    winA = 50
    winB = 50
    factors.length = 0
  }
  return {
    team_a: winA,
    team_b: winB,
    confidence: (possTime >= 2 || input.ballX != null ? 'high' : 'live') as 'high' | 'live',
    reason: factors.map((f) => f.label.toLowerCase()).join(', ') || 'even state',
    factors: factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
  }
}

const AVERAGE_PLAYER_HEIGHT_M = 1.8

/**
 * Converts image distances to metres with a correction for perspective.
 *
 * A single pixels-per-metre scalar is only valid at one depth. On a broadcast
 * angle the ground recedes, so players near the top of frame are smaller and a
 * vertical pixel there spans several times more turf than one near the touchline.
 * Applying one scale to the whole frame made a team spread across the pitch
 * measure five metres wide.
 *
 * Players are a known height, so their apparent height at each image row is a
 * ruler for that row. Fitting height against row gives scale as a function of
 * depth; integrating 1/height along the vertical span converts it honestly.
 */
export interface PitchScale {
  /** Metres per pixel at a given image row. */
  at: (y: number) => number
  /** Metres between two image points, integrating the vertical span. */
  distance: (a: { x: number; y: number }, b: { x: number; y: number }) => number
  /** Fallback scale, for callers that only need one number. */
  median: number
  /** True when enough players were seen at differing depths to fit perspective. */
  calibrated: boolean
}

function buildPitchScale(tracks: NormalizedTrack[]): PitchScale {
  const samples: Array<{ y: number; h: number }> = []
  tracks.forEach((track) => {
    if (!isPerson(track)) return
    track.positions.forEach((pos) => {
      // Fitted on box-centre rows because that is where every consumer
      // evaluates it. Fitting on foot rows and reading at centres made
      // heightAt return h*(1 - slope/2), inflating every metre figure by
      // 1/(1 - slope/2) - about 20% on a gentle angle, over 40% on a steep one.
      if (pos.h > 4) samples.push({ y: pos.y + pos.h / 2, h: pos.h })
    })
  })

  const heights = samples.map((sample) => sample.h)
  const medianHeight = heights.length ? median(heights) : 0
  const fallback = medianHeight > 4 ? AVERAGE_PLAYER_HEIGHT_M / medianHeight : 105 / 1280

  // Least-squares fit of apparent height against image row.
  let slope = 0
  let intercept = medianHeight
  let calibrated = false
  if (samples.length >= 12) {
    const n = samples.length
    const meanY = samples.reduce((sum, s) => sum + s.y, 0) / n
    const meanH = samples.reduce((sum, s) => sum + s.h, 0) / n
    let num = 0
    let den = 0
    for (const sample of samples) {
      num += (sample.y - meanY) * (sample.h - meanH)
      den += (sample.y - meanY) ** 2
    }
    if (den > 1) {
      const a = num / den
      const b = meanH - a * meanY
      // Single pass: spreading one argument per tracked position overflows the
      // call stack on a full batch summary.
      let minY = Infinity
      let maxY = -Infinity
      for (const sample of samples) {
        if (sample.y < minY) minY = sample.y
        if (sample.y > maxY) maxY = sample.y
      }
      const ySpread = maxY - minY
      // Only trust the fit when players were actually seen at different depths
      // and it stays positive across the observed range.
      if (a > 0 && ySpread > 40 && b + a * minY > 3) {
        slope = a
        intercept = b
        calibrated = true
      }
    }
  }

  const heightAt = (y: number) => Math.max(slope * y + intercept, 3)
  const at = (y: number) => (calibrated ? AVERAGE_PLAYER_HEIGHT_M / heightAt(y) : fallback)

  const verticalMetres = (y1: number, y2: number) => {
    const lo = Math.min(y1, y2)
    const hi = Math.max(y1, y2)
    if (!calibrated || slope <= 0) return (hi - lo) * fallback
    const top = heightAt(lo)
    const bottom = heightAt(hi)
    // Integral of 1/(slope*y + intercept) dy, scaled to metres.
    return (AVERAGE_PLAYER_HEIGHT_M / slope) * Math.log(bottom / top)
  }

  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dy = verticalMetres(a.y, b.y)
    // Horizontal scale is taken at the midpoint row, where the span sits.
    const dx = (b.x - a.x) * at((a.y + b.y) / 2)
    return Math.sqrt(dx * dx + dy * dy)
  }

  return { at, distance, median: fallback, calibrated }
}

function playerMetrics(tracks: NormalizedTrack[], fps: number, scale: PitchScale): PlayerMetric[] {
  const safeFps = Math.max(fps, 1)
  const SPRINT_MS = 7
  // No human runs faster than this. A step implying more is the tracker having
  // swapped identities or jumped, not a player moving: it is discarded rather
  // than clamped, because a teleport is not distance covered either. The old
  // guard was a pixel threshold, which cannot catch this - the same pixel jump
  // converts to a far larger distance near the top of frame, where players are
  // small and each pixel spans more turf.
  const MAX_HUMAN_MS = 12
  return tracks
    .filter((track) => isPerson(track) && track.positions.length >= 2)
    .map((track) => {
      let distance = 0
      let distanceMetres = 0
      let maxSpeed = 0
      let maxSpeedMetres = 0
      let sprints = 0
      let inSprint = false
      let fastStreak = 0
      // Summed from the steps actually accepted, so replayed footage cannot
      // report more distance than the time it was observed over.
      let elapsed = 0
      for (let i = 1; i < track.positions.length; i++) {
        const prev = center(track.positions[i - 1])
        const curr = center(track.positions[i])
        const frameDelta = track.positions[i].frame - track.positions[i - 1].frame
        // Seeking or replaying rewinds the frame id, so the sequence is not
        // monotonic. Flooring a negative delta divided real displacement by a
        // single frame and reported it as speed.
        if (frameDelta <= 0) {
          inSprint = false
          fastStreak = 0
          continue
        }
        const step = dist(prev, curr)
        const stepMetres = scale.distance(prev, curr)
        const dt = frameDelta / safeFps
        const speedMetres = stepMetres / dt

        if (!Number.isFinite(speedMetres) || speedMetres > MAX_HUMAN_MS) {
          inSprint = false
          fastStreak = 0
          continue
        }

        distance += step
        distanceMetres += stepMetres
        elapsed += dt
        const speed = step / dt
        maxSpeed = Math.max(maxSpeed, speed)
        maxSpeedMetres = Math.max(maxSpeedMetres, speedMetres)
        const sprinting = speedMetres > SPRINT_MS
        // Two consecutive fast samples: a single one is usually a detector
        // wobble or an identity swap, not a player accelerating away.
        if (sprinting && fastStreak === 1 && !inSprint) {
          sprints += 1
          inSprint = true
        }
        fastStreak = sprinting ? fastStreak + 1 : 0
        if (!sprinting) inSprint = false
      }
      const last = track.positions[track.positions.length - 1]
      const timeOnField = elapsed
      return {
        id: track.id,
        team: track.team,
        jersey: track.jersey,
        color: track.color,
        frames: track.positions.length,
        timeOnField,
        distancePx: distance,
        distanceM: distanceMetres,
        avgSpeed: timeOnField > 0 ? distance / timeOnField : 0,
        maxSpeed,
        avgSpeedM: timeOnField > 0 ? distanceMetres / timeOnField : 0,
        maxSpeedM: maxSpeedMetres,
        sprints,
        lastPosition: last,
      }
    })
    .sort((a, b) => b.distancePx - a.distancePx)
}

function latestPositions(tracks: NormalizedTrack[]) {
  return tracks
    .filter((track) => isPerson(track) && track.positions.length > 0)
    .map((track) => ({
      id: track.id,
      team: track.team,
      ...center(track.positions[track.positions.length - 1]),
    }))
}

function formationName(players: Array<{ x: number }>, defendLowX: boolean) {
  if (players.length === 0) return '—'
  // Too few tracked to read a shape. Returning "4 players" here put that string
  // in the slot where a formation like 4-4-2 is displayed, which read as a bug.
  if (players.length < 5) return 'shape unclear'
  const xs = players.map((player) => player.x)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const range = Math.max(maxX - minX, 1)
  const bands = [0, 0, 0]
  players.forEach((player) => {
    const normalized = defendLowX ? (player.x - minX) / range : (maxX - player.x) / range
    const band = Math.min(2, Math.floor(normalized * 3))
    bands[band]++
  })
  return `${bands[0]}-${bands[1]}-${bands[2]}`
}

function teamStats(tracks: NormalizedTrack[], scale: PitchScale) {
  const latest = latestPositions(tracks)
  const teamA = latest.filter((player) => player.team === 'team_a')
  const teamB = latest.filter((player) => player.team === 'team_b')

  // Which end a side attacks cannot be assumed. Teams are labelled A and B by
  // jersey colour, which says nothing about direction of play, so hardcoding
  // "A attacks right" made formations and attacking-third shares wrong
  // whenever the clustering happened to land the other way round. The side
  // sitting deeper is the one defending that end.
  const meanAX = teamA.length ? mean(teamA.map((player) => player.x)) : null
  const meanBX = teamB.length ? mean(teamB.map((player) => player.x)) : null
  const aDefendsLowX = meanAX != null && meanBX != null ? meanAX < meanBX : true

  const summarize = (players: typeof teamA, defendLowX: boolean) => {
    if (players.length === 0) {
      return { name: '—', count: 0, width: 0, depth: 0, widthM: 0, depthM: 0, center: { x: 0, y: 0 } }
    }
    const xs = players.map((player) => player.x)
    const ys = players.map((player) => player.y)
    const width = Math.max(...ys) - Math.min(...ys)
    const depth = Math.max(...xs) - Math.min(...xs)
    const midY = mean(ys)
    // Width runs across the image (into depth); depth runs along it.
    const widthM = scale.distance({ x: 0, y: Math.min(...ys) }, { x: 0, y: Math.max(...ys) })
    const depthM = scale.distance({ x: Math.min(...xs), y: midY }, { x: Math.max(...xs), y: midY })
    return {
      name: formationName(players, defendLowX),
      count: players.length,
      width: Math.round(width),
      depth: Math.round(depth),
      widthM,
      depthM,
      center: { x: mean(xs), y: mean(ys) },
    }
  }

  const a = summarize(teamA, aDefendsLowX)
  const b = summarize(teamB, !aDefendsLowX)
  const separation = Math.abs(a.center.x - b.center.x)
  const separationM = a.count && b.count ? scale.distance(a.center, b.center) : 0
  return {
    teamA: a,
    teamB: b,
    separation: Math.round(separation),
    separationM,
    aDefendsLowX,
  }
}

function interpolateTrackAt(track: NormalizedTrack, frame: number): TrackPosition | null {
  const positions = track.positions
  if (!positions.length) return null
  if (frame <= positions[0].frame) return positions[0]
  const last = positions[positions.length - 1]
  if (frame >= last.frame) return last

  // Binary search: this runs once per player per sampled frame, so a linear
  // scan here dominates the whole live analytics pass.
  let lo = 0
  let hi = positions.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (positions[mid].frame <= frame) lo = mid
    else hi = mid
  }
  const prev = positions[lo]
  const next = positions[hi]
  if (frame === next.frame) return next
  if (frame === prev.frame) return prev
  const t = (frame - prev.frame) / Math.max(next.frame - prev.frame, 1)
  return {
    frame,
    x: prev.x + (next.x - prev.x) * t,
    y: prev.y + (next.y - prev.y) * t,
    w: prev.w + (next.w - prev.w) * t,
    h: prev.h + (next.h - prev.h) * t,
    score: next.score,
  }
}

interface OwnerSample {
  frame: number
  id: string
  team: TeamId
  pos: TrackPosition
}

const EMPTY_POSSESSION = {
  team_a_possession: 0,
  team_b_possession: 0,
  team_a_percentage: 0,
  team_b_percentage: 0,
  total_possession_time: 0,
  possession_events: 0,
  passes: 0,
  current_possession: null as { player_id: string; team: string } | null,
  source: 'none' as PossessionSource,
}

const EMPTY_PASSES = {
  total_passes: 0,
  successful_passes: 0,
  pass_success_rate: 0,
  team_a_passes: 0,
  team_b_passes: 0,
  recent_passes: [] as PassEvent[],
  top_passers: [] as Array<{ player: string; passes: number }>,
  top_recipients: [] as Array<{ player: string; receptions: number }>,
  pass_matrix: [] as Array<{ from: string; to: string; count: number }>,
  source: 'none' as PossessionSource,
}

/**
 * Frames at which at least one player was observed, ascending and capped.
 *
 * Possession is integrated from the gap between consecutive samples, so
 * thinning the sample set keeps the totals proportional while bounding the
 * per-update cost of the live pass.
 */
function observedFrames(people: NormalizedTrack[], limit = 260) {
  const frames = new Set<number>()
  people.forEach((track) => track.positions.forEach((pos) => frames.add(pos.frame)))
  const sorted = Array.from(frames).sort((a, b) => a - b)
  if (sorted.length <= limit) return sorted
  const stride = Math.ceil(sorted.length / limit)
  const thinned: number[] = []
  for (let i = 0; i < sorted.length; i += stride) thinned.push(sorted[i])
  const last = sorted[sorted.length - 1]
  if (thinned[thinned.length - 1] !== last) thinned.push(last)
  return thinned
}

/**
 * Requires a challenger to be nearest for two consecutive samples before
 * possession transfers.
 *
 * When two players contest a ball the nearest one alternates frame to frame.
 * Without this, each flicker is recorded as a change of possession, which
 * buries genuine passes under phantom turnovers.
 */
class OwnershipHysteresis {
  private held: { id: string; team: TeamId } | null = null
  private pending: { id: string; team: TeamId } | null = null
  private pendingCount = 0

  constructor(private readonly required = 2) {}

  get current() {
    return this.held
  }

  /**
   * @param holderOutOfRange True when the current holder is too far from the
   *   action to still have the ball. Flicker suppression must not survive a
   *   pass: a player cannot keep possession from thirty metres away, so an
   *   out-of-range holder yields immediately.
   */
  claim(candidate: { id: string; team: TeamId }, holderOutOfRange = false) {
    if (holderOutOfRange && this.held && this.held.id !== candidate.id) {
      this.held = candidate
      this.pending = null
      this.pendingCount = 0
      return this.held
    }
    if (!this.held || this.held.id === candidate.id) {
      this.held = candidate
      this.pending = null
      this.pendingCount = 0
    } else if (this.pending && this.pending.id === candidate.id) {
      this.pendingCount++
      if (this.pendingCount >= this.required) {
        this.held = this.pending
        this.pending = null
        this.pendingCount = 0
      }
    } else {
      this.pending = candidate
      this.pendingCount = 1
    }
    return this.held
  }
}

/** Ball position at a frame, but only when a real sample is close by. */
function ballPositionAt(
  ball: NormalizedTrack | undefined,
  frame: number,
  maxGapFrames: number,
): TrackPosition | null {
  if (!ball || !ball.positions.length) return null
  const positions = ball.positions
  if (frame < positions[0].frame - maxGapFrames) return null
  if (frame > positions[positions.length - 1].frame + maxGapFrames) return null

  let lo = 0
  let hi = positions.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (positions[mid].frame <= frame) lo = mid
    else hi = mid
  }
  const nearest =
    Math.abs(positions[lo].frame - frame) <= Math.abs(positions[hi].frame - frame)
      ? positions[lo]
      : positions[hi]
  if (Math.abs(nearest.frame - frame) > maxGapFrames) return null
  return interpolateTrackAt(ball, frame)
}

/**
 * One possession sequence for the whole clip.
 *
 * Every observed frame gets an owner. Where the ball is tracked, it anchors the
 * action; where it is not, the blend of crowd centre and frame centre stands in
 * for it, since broadcast cameras keep play near the middle of shot.
 *
 * Running a single sequence rather than choosing between a ball model and a
 * proximity model matters: gating strictly on ball-to-player reach leaves only
 * a handful of samples on real footage, and a possession split drawn from a
 * handful of samples collapses to 100/0.
 */
function ownerSequence(
  people: NormalizedTrack[],
  ball: NormalizedTrack | undefined,
  resolution: [number, number] | null,
  fps: number,
) {
  const frames = observedFrames(people)
  const samples: OwnerSample[] = []
  const ownership = new OwnershipHysteresis()
  const maxGapFrames = Math.max(Math.round(fps * 0.5), 4)
  let ballAnchored = 0

  for (const frame of frames) {
    const present: Array<{ id: string; team: TeamId; pos: TrackPosition; c: { x: number; y: number } }> = []
    for (const player of people) {
      const pos = interpolateTrackAt(player, frame)
      if (!pos) continue
      present.push({ id: player.id, team: player.team, pos, c: center(pos) })
    }
    if (!present.length) continue

    const ballPos = ballPositionAt(ball, frame, maxGapFrames)
    let action: { x: number; y: number }
    if (ballPos) {
      action = center(ballPos)
      ballAnchored++
    } else {
      if (present.length < 2) continue
      const crowd = {
        x: mean(present.map((p) => p.c.x)),
        y: mean(present.map((p) => p.c.y)),
      }
      action = resolution
        ? { x: crowd.x * 0.45 + (resolution[0] / 2) * 0.55, y: crowd.y * 0.45 + (resolution[1] / 2) * 0.55 }
        : crowd
    }

    const ranked = present
      .map((p) => ({ ...p, d: dist(action, p.c) }))
      .sort((a, b) => a.d - b.d)
    const best = ranked[0]
    const runnerUp = ranked[1]

    // With the ball anchoring the action, a contested ball is genuinely
    // ambiguous and should hold rather than flip. Require a clear nearest.
    const margin = Math.max(best.pos.w, 18) * (ballPos ? 0.35 : 0.6)
    const decisive = !runnerUp || runnerUp.d - best.d > margin

    // How far the current holder now sits from the action.
    const current = ownership.current
    const heldEntry = current ? ranked.find((p) => p.id === current.id) : undefined
    const holderReach = heldEntry ? Math.max(heldEntry.pos.h * 2.5, heldEntry.pos.w * 3, 80) : 0
    const holderOutOfRange = Boolean(heldEntry) && heldEntry!.d > holderReach

    if (!decisive && !holderOutOfRange) {
      if (current) {
        const heldPos = heldEntry?.pos || best.pos
        samples.push({ frame, id: current.id, team: current.team, pos: heldPos })
      }
      continue
    }

    const owner = ownership.claim({ id: best.id, team: best.team }, holderOutOfRange)
    const ownerPos = ranked.find((p) => p.id === owner.id)?.pos || best.pos
    samples.push({ frame, id: owner.id, team: owner.team, pos: ownerPos })
  }

  const coverage = samples.length ? ballAnchored / samples.length : 0
  return { samples, coverage }
}

/** Turns a sequence of ball-owner samples into possession, passes and events. */
function summarizeOwners(samples: OwnerSample[], fps: number, source: PossessionSource, scale: PitchScale) {
  const safeFps = Math.max(fps, 1)
  let teamA = 0
  let teamB = 0
  let events = 0
  const recent: PassEvent[] = []
  const matchEvents: MatchEvent[] = []
  const passerCounts = new Map<string, number>()
  const recipientCounts = new Map<string, number>()
  const matrix = new Map<string, number>()
  let lastOwner: OwnerSample | null = null
  let current: { player_id: string; team: string } | null = null

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const previousFrame = i === 0 ? sample.frame : samples[i - 1].frame
    const dt = Math.min(
      Math.max((sample.frame - previousFrame) / safeFps, 1 / safeFps),
      1.5,
    )
    if (sample.team === 'team_a') teamA += dt
    else if (sample.team === 'team_b') teamB += dt
    current = { player_id: sample.id, team: sample.team }

    if (lastOwner && lastOwner.id !== sample.id) {
      events += 1
      const gap = sample.frame - lastOwner.frame
      const time = sample.frame / safeFps
      const passDist = dist(center(lastOwner.pos), center(sample.pos))
      const passMetres = scale.distance(center(lastOwner.pos), center(sample.pos))
      const withinPassWindow = gap <= Math.max(safeFps * 4, 12)
      // Below roughly a couple of body-widths the ball was taken off the
      // player rather than played: a tackle or a loose-ball duel, not a pass.
      const travelled = passDist > Math.max(lastOwner.pos.w * 2, 40)

      if (lastOwner.team === sample.team && withinPassWindow) {
        recent.push({
          from_player: lastOwner.id,
          to_player: sample.id,
          successful: true,
          timestamp: time,
          distance: passMetres,
          team: sample.team,
          frame: sample.frame,
        })
        passerCounts.set(lastOwner.id, (passerCounts.get(lastOwner.id) || 0) + 1)
        recipientCounts.set(sample.id, (recipientCounts.get(sample.id) || 0) + 1)
        const key = `${lastOwner.id}->${sample.id}`
        matrix.set(key, (matrix.get(key) || 0) + 1)
        matchEvents.push({
          id: `pass-${sample.frame}-${lastOwner.id}-${sample.id}`,
          type: 'pass',
          frame: sample.frame,
          time,
          team: sample.team,
          label: `Pass P${lastOwner.id} → P${sample.id}`,
          detail: `${passMetres.toFixed(0)} m`,
        })
      } else if (lastOwner.team !== sample.team && hasAssignedTeam(lastOwner.team)) {
        // The ball changed team. If it travelled, the previous holder attempted
        // a pass and lost it: an intercepted, unsuccessful pass. Recording only
        // the completions is what made the success rate a constant 100%.
        if (withinPassWindow && travelled) {
          recent.push({
            from_player: lastOwner.id,
            to_player: sample.id,
            successful: false,
            timestamp: time,
            distance: passMetres,
            team: lastOwner.team,
            frame: sample.frame,
          })
          passerCounts.set(lastOwner.id, (passerCounts.get(lastOwner.id) || 0) + 1)
        }
        matchEvents.push({
          id: `turnover-${sample.frame}-${sample.id}`,
          type: 'turnover',
          frame: sample.frame,
          time,
          team: sample.team,
          label: travelled ? `Interception by P${sample.id}` : `Ball won by P${sample.id}`,
          detail: sample.team === 'team_a' ? 'Team A regains' : 'Team B regains',
        })
      }
    }
    lastOwner = sample
  }

  // Possession over the trailing third of the sequence, for momentum.
  const recentFrom = Math.floor(samples.length * 0.67)
  let recentA = 0
  let recentB = 0
  for (let i = Math.max(1, recentFrom); i < samples.length; i++) {
    const step = Math.min(Math.max((samples[i].frame - samples[i - 1].frame) / safeFps, 1 / safeFps), 1.5)
    if (samples[i].team === 'team_a') recentA += step
    else if (samples[i].team === 'team_b') recentB += step
  }
  const recentTotal = recentA + recentB
  const recentPossessionA = recentTotal > 0.3 ? (recentA / recentTotal) * 100 : null

  const completed = recent.filter((pass) => pass.successful).length

  const total = teamA + teamB
  const meaningful = total >= 0.35
  const top = (counts: Map<string, number>, key: 'passes' | 'receptions') =>
    Array.from(counts.entries())
      .map(([player, value]) => ({ player, [key]: value }) as any)
      .sort((a, b) => b[key] - a[key])
      .slice(0, 5)

  return {
    possession: {
      team_a_possession: teamA,
      team_b_possession: teamB,
      team_a_percentage: meaningful ? (teamA / total) * 100 : 0,
      team_b_percentage: meaningful ? (teamB / total) * 100 : 0,
      total_possession_time: total,
      possession_events: events,
      passes: completed,
      current_possession: current,
      source,
    },
    passes: {
      // Attempts, not just completions, so the rate is a real percentage.
      total_passes: recent.length,
      successful_passes: completed,
      pass_success_rate: recent.length > 0 ? (completed / recent.length) * 100 : 0,
      team_a_passes: recent.filter((pass) => pass.team === 'team_a').length,
      team_b_passes: recent.filter((pass) => pass.team === 'team_b').length,
      recent_passes: recent.slice(-12),
      top_passers: top(passerCounts, 'passes'),
      top_recipients: top(recipientCounts, 'receptions'),
      pass_matrix: Array.from(matrix.entries()).map(([key, count]) => {
        const [from, to] = key.split('->')
        return { from, to, count }
      }),
      source,
    },
    events: matchEvents,
    recentPossessionA,
  }
}

function possessionAndPasses(
  tracks: NormalizedTrack[],
  fps: number,
  resolution: [number, number] | null,
  scale: PitchScale,
) {
  const ball = tracks.find((track) => track.class === 'ball' && track.positions.length > 0)
  const people = tracks.filter((track) => isPerson(track) && track.positions.length > 0)
  const ballDetected = Boolean(ball)

  if (people.length === 0) {
    return {
      possession: EMPTY_POSSESSION,
      passes: EMPTY_PASSES,
      events: [] as MatchEvent[],
      ballDetected,
      ballCoverage: 0,
      recentPossessionA: null as number | null,
    }
  }

  const { samples, coverage } = ownerSequence(people, ball, resolution, fps)
  // Report the model that actually drove most of the samples.
  const source: PossessionSource = coverage >= 0.5 ? 'ball' : 'proximity'
  const summary = summarizeOwners(samples, fps, source, scale)
  return { ...summary, ballDetected, ballCoverage: coverage }
}

function looksFakeWorkerStats(stats: any) {
  if (!stats) return true
  const events = Number(stats.possession_events || 0)
  const totalTime = Number(stats.total_possession_time || 0)
  const a = Number(stats.team_a_percentage || 0)
  const b = Number(stats.team_b_percentage || 0)
  if (totalTime < 0.35) return true
  if (totalTime <= 0 && events === 0) return true
  if (Math.abs(totalTime - 30) < 0.01 && events === 0) return true
  if (events === 0 && a === 50 && b === 50) return true
  return false
}

function looksFakePassStats(stats: any) {
  if (!stats) return true
  if (!Array.isArray(stats.recent_passes) || stats.recent_passes.length === 0) {
    return Number(stats.total_passes || 0) > 0
  }
  return false
}

export function deriveAnalytics(
  tracksMap: Map<string, any>,
  analyticsData: any,
  fps = 30,
): DerivedAnalytics {
  const labeled = keepActiveTracks(
    assignTeams(collectTracks(tracksMap, analyticsData?.tracking_data, analyticsData?.frame_id || 0)),
  )
  const scale = buildPitchScale(labeled)
  const players = playerMetrics(labeled, fps, scale)
  const team = teamStats(labeled, scale)
  const resolution = Array.isArray(analyticsData?.resolution) && analyticsData.resolution.length === 2
    ? ([Number(analyticsData.resolution[0]), Number(analyticsData.resolution[1])] as [number, number])
    : null
  const computed = possessionAndPasses(labeled, fps, resolution, scale)

  const workerPossession = analyticsData?.possession_stats
  const workerPasses = analyticsData?.pass_stats
  const hasComputedPossession = computed.possession.total_possession_time >= 0.35
  const possession = hasComputedPossession || looksFakeWorkerStats(workerPossession) || !workerPossession
    ? computed.possession
    : {
        ...computed.possession,
        team_a_possession: Number(workerPossession.team_a_possession || 0),
        team_b_possession: Number(workerPossession.team_b_possession || 0),
        team_a_percentage: Number(workerPossession.team_a_percentage || 0),
        team_b_percentage: Number(workerPossession.team_b_percentage || 0),
        total_possession_time: Number(workerPossession.total_possession_time || 0),
        possession_events: Number(workerPossession.possession_events || 0),
        passes: Number(workerPossession.passes || computed.possession.passes),
        current_possession: workerPossession.current_possession || computed.possession.current_possession,
      }

  const passes = computed.passes.total_passes > 0 || looksFakePassStats(workerPasses)
    ? computed.passes
    : {
        ...computed.passes,
        total_passes: Number(workerPasses?.total_passes || 0),
        successful_passes: Number(workerPasses?.successful_passes || 0),
        pass_success_rate: Number(workerPasses?.pass_success_rate || 0),
        team_a_passes: Number(workerPasses?.team_a_passes || 0),
        team_b_passes: Number(workerPasses?.team_b_passes || 0),
        recent_passes: (workerPasses?.recent_passes || []).map((pass: any) => ({
          from_player: String(pass.from_player),
          to_player: String(pass.to_player),
          successful: Boolean(pass.successful),
          timestamp: Number(pass.timestamp || 0),
          distance: Number(pass.distance || 0),
          team: String(pass.team || pass.from_team || 'unknown'),
        })),
        source: 'worker' as const,
      }

  const heatmapPlayers = labeled
    .filter((track) => isPerson(track) && track.positions.length > 0)
    .map((track) => ({
      id: track.id,
      team: track.team,
      points: track.positions.map((pos) => ({
        x: center(pos).x,
        y: center(pos).y,
        intensity: pos.score || 1,
      })),
      timeOnField: Math.max(
        (track.positions[track.positions.length - 1].frame - track.positions[0].frame) / Math.max(fps, 1),
        0,
      ),
    }))

  const teamPoints = new Map<TeamId, Array<{ x: number; y: number; intensity: number }>>()
  heatmapPlayers.forEach((player) => {
    const list = teamPoints.get(player.team) || []
    list.push(...player.points)
    teamPoints.set(player.team, list)
  })

  // Prefer the real frame size; fall back to the span the tracks actually
  // cover, so every grid is drawn against the same reference.
  const heatmapExtent = (() => {
    if (resolution) return { minX: 0, minY: 0, maxX: resolution[0], maxY: resolution[1] }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    heatmapPlayers.forEach((player) => {
      player.points.forEach((point) => {
        if (point.x < minX) minX = point.x
        if (point.x > maxX) maxX = point.x
        if (point.y < minY) minY = point.y
        if (point.y > maxY) maxY = point.y
      })
    })
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1280, maxY: 720 }
    return { minX, minY, maxX, maxY }
  })()

  const colorsFromTracks = {
    team_a: labeled.find((track) => track.team === 'team_a' && track.color)?.color
      || analyticsData?.team_colors?.team_a
      || DEFAULT_TEAM_COLORS.team_a,
    team_b: labeled.find((track) => track.team === 'team_b' && track.color)?.color
      || analyticsData?.team_colors?.team_b
      || DEFAULT_TEAM_COLORS.team_b,
  }

  const latest = latestPositions(labeled)
  // Square metres: raw square pixels are not a quantity anyone can act on, and
  // they change meaning with every camera zoom.
  const compactness = (side: 'team_a' | 'team_b') => {
    const pts = latest.filter((p) => p.team === side)
    if (pts.length < 2) return 0
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const midY = mean(ys)
    const widthM = scale.distance({ x: 0, y: Math.min(...ys) }, { x: 0, y: Math.max(...ys) })
    const lengthM = scale.distance({ x: Math.min(...xs), y: midY }, { x: Math.max(...xs), y: midY })
    return Math.round(widthM * lengthM)
  }
  const allX = latest.map((p) => p.x)
  const minX = allX.length ? Math.min(...allX) : 0
  const maxX = allX.length ? Math.max(...allX) : 1
  const rangeX = Math.max(maxX - minX, 1)
  const attackingShare = (side: 'team_a' | 'team_b', attackHighX: boolean) => {
    const pts = latest.filter((p) => p.team === side)
    if (!pts.length) return 0
    const inThird = pts.filter((p) => {
      const t = (p.x - minX) / rangeX
      return attackHighX ? t > 0.66 : t < 0.34
    }).length
    return (inThird / pts.length) * 100
  }

  const ballTrack = labeled.find((track) => track.class === 'ball' && track.positions.length > 0)
  const lastBall = ballTrack?.positions[ballTrack.positions.length - 1]
  const meanX = (side: 'team_a' | 'team_b') => {
    const pts = latest.filter((p) => p.team === side)
    if (!pts.length) return null
    return pts.reduce((sum, p) => sum + p.x, 0) / pts.length
  }
  const fieldWidth = Math.max(maxX, Number(analyticsData?.resolution?.[0] || 1280), 1)
  const win = computeWinProbability({
    recentPossessionA: computed.recentPossessionA ?? null,
    possessionA: possession.team_a_percentage,
    possessionB: possession.team_b_percentage,
    possessionTime: possession.total_possession_time,
    attackingA: attackingShare('team_a', team.aDefendsLowX),
    attackingB: attackingShare('team_b', !team.aDefendsLowX),
    teamAPasses: passes.team_a_passes,
    teamBPasses: passes.team_b_passes,
    ballX: lastBall ? lastBall.x + lastBall.w / 2 : null,
    fieldWidth,
    meanTeamAX: meanX('team_a'),
    meanTeamBX: meanX('team_b'),
    hasPeople: latest.some((p) => p.team === 'team_a' || p.team === 'team_b'),
  })

  const sprintEvents: MatchEvent[] = players
    .filter((player) => player.sprints > 0 && player.lastPosition)
    .slice(0, 8)
    .map((player) => ({
      id: `sprint-${player.id}`,
      type: 'sprint' as const,
      frame: player.lastPosition!.frame,
      time: player.lastPosition!.frame / Math.max(fps, 1),
      team: player.team,
      label: `P${player.id} sprint burst${player.sprints > 1 ? ` x${player.sprints}` : ''}`,
      detail: `${fmt(player.maxSpeedM)} m/s peak`,
    }))

  const events = [...computed.events, ...sprintEvents]
    .sort((a, b) => a.frame - b.frame)
    .slice(-60)

  const ready = labeled.some((track) => track.positions.length > 0)
  return {
    ready,
    events,
    emptyReason: ready ? '' : 'Press play to start live analysis',
    ballDetected: computed.ballDetected,
    ballCoverage: Number((computed as any).ballCoverage || 0),
    playerCount: players.length,
    objectCount: labeled.length,
    frameId: Number(analyticsData?.frame_id || 0),
    fps,
    players,
    possession,
    passes,
    team,
    teamColors: colorsFromTracks,
    teamLabels: {
      team_a: `Team A · ${colorName(colorsFromTracks.team_a)}`,
      team_b: `Team B · ${colorName(colorsFromTracks.team_b)}`,
    },
    extras: {
      sprints: players.reduce((sum, player) => sum + player.sprints, 0),
      compactnessA: compactness('team_a'),
      compactnessB: compactness('team_b'),
      attackingThirdA: attackingShare('team_a', team.aDefendsLowX),
      attackingThirdB: attackingShare('team_b', !team.aDefendsLowX),
      metersPerPixel: scale.median,
      winA: win.team_a,
      winB: win.team_b,
      winConfidence: win.confidence,
      winReason: win.reason,
      winFactors: win.factors,
    },
    heatmaps: {
      extent: heatmapExtent,
      players: heatmapPlayers,
      teams: Array.from(teamPoints.entries()).map(([teamId, points]) => ({ team: teamId, points })),
    },
  }
}

export function enrichTrackMap(tracks: Map<string, any>) {
  const labeled = assignTeams(collectTracks(tracks))
  const next = new Map<string, any>()
  labeled.forEach((track) => {
    const original = tracks.get(track.id) || {}
    next.set(track.id, { ...original, ...track })
  })
  return next
}

function pruneStaleTracks(tracks: Map<string, any>, frameId: number, maxPeople = 24) {
  const staleBefore = Math.max(0, frameId - 48)
  const people: Array<{ id: string; track: any; frames: number; last: number }> = []
  const kept = new Map<string, any>()

  tracks.forEach((track, id) => {
    const positions = Array.isArray(track.positions) ? track.positions : []
    const last = positions[positions.length - 1]
    if (!last || last.frame < staleBefore) return
    if (track.class === 'ball') {
      kept.set(String(id), track)
      return
    }
    people.push({ id: String(id), track, frames: positions.length, last: last.frame })
  })

  people
    .sort((a, b) => b.last - a.last || b.frames - a.frames)
    .slice(0, maxPeople)
    .forEach((item) => kept.set(item.id, item.track))
  return kept
}

export function mergeRealtimeTracks(
  current: Map<string, any>,
  trackingData: any[],
  frameId: number,
  maxPositions = 480,
) {
  const next = new Map(current)
  trackingData.forEach((obj) => {
    const id = String(obj.track_id ?? obj.id)
    const existing = next.get(id) || {
      id,
      class: obj.class || 'person',
      team: obj.team || 'unknown',
      jersey: null,
      color: obj.color,
      positions: [],
    }
    const bbox = obj.bbox || [0, 0, 0, 0]
    const positions = Array.isArray(existing.positions) ? existing.positions.slice() : []
    const last = positions[positions.length - 1]
    if (!last || last.frame !== frameId) {
      positions.push({
        frame: frameId,
        x: Number(bbox[0]) || 0,
        y: Number(bbox[1]) || 0,
        w: Number(bbox[2]) || 0,
        h: Number(bbox[3]) || 0,
        score: Number(obj.confidence ?? obj.score ?? 0),
      })
      if (positions.length > maxPositions) {
        positions.splice(0, positions.length - maxPositions)
      }
    }
    next.set(id, {
      ...existing,
      id,
      class: obj.class || existing.class || 'person',
      team: obj.team || existing.team || 'unknown',
      color: obj.color || existing.color,
      positions,
    })
  })
  return enrichTrackMap(pruneStaleTracks(next, frameId))
}

/**
 * Display name for a team id. Referees, keepers and ambiguous shirts are
 * deliberately left unassigned by the classifier, and the raw id was reaching
 * the screen in the slot where a team name goes.
 */
export function teamLabel(
  team: string,
  labels: { team_a: string; team_b: string },
) {
  if (team === 'team_a') return labels.team_a
  if (team === 'team_b') return labels.team_b
  if (team === 'ball') return 'Ball'
  return 'Unassigned'
}

export function fmt(value?: number | null, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return '0.0'
  return Number(value).toFixed(digits)
}
