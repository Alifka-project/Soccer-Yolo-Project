export interface DemoTrack {
  id: number
  team: 'team_a' | 'team_b' | 'ball'
  class: 'person' | 'ball'
  jersey: number | null
  positions: Array<{
    frame: number
    x: number
    y: number
    w: number
    h: number
    score: number
  }>
}

export interface DemoAnalytics {
  frame_id: number
  possession_stats: {
    team_a_possession: number
    team_b_possession: number
    team_a_percentage: number
    team_b_percentage: number
    total_possession_time: number
    possession_events: number
    passes: number
    current_possession: null
  }
  pass_stats: {
    total_passes: number
    successful_passes: number
    pass_success_rate: number
    team_a_passes: number
    team_b_passes: number
    recent_passes: Array<{
      from_player: number
      to_player: number
      successful: boolean
      timestamp: number
      distance: number
      team: string
    }>
  }
  tracking_data: Array<{
    track_id: number
    bbox: number[]
    class: string
    confidence: number
    center: number[]
  }>
  timestamp: number
}

function seeded(seed: number) {
  let value = seed % 2147483647
  if (value <= 0) value += 2147483646
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

export function generateDemoTracks(totalFrames = 240, playerCount = 22) {
  const random = seeded(26)
  const tracks: Record<string, DemoTrack> = {}

  for (let i = 0; i < playerCount; i++) {
    const team = i < playerCount / 2 ? 'team_a' : 'team_b'
    const startX = team === 'team_a' ? 180 + (i % 11) * 70 : 980 + (i % 11) * 70
    const startY = 120 + (i % 11) * 55
    const positions = []

    for (let frame = 0; frame < totalFrames; frame++) {
      const driftX = Math.sin((frame + i * 8) / 18) * 90
      const driftY = Math.cos((frame + i * 5) / 22) * 50
      positions.push({
        frame,
        x: startX + driftX,
        y: startY + driftY,
        w: 42,
        h: 86,
        score: 0.78 + random() * 0.2,
      })
    }

    tracks[String(i)] = {
      id: i,
      team,
      class: 'person',
      jersey: (i % 11) + 1,
      positions,
    }
  }

  const ballPositions = []
  for (let frame = 0; frame < totalFrames; frame++) {
    ballPositions.push({
      frame,
      x: 640 + Math.sin(frame / 12) * 280,
      y: 360 + Math.cos(frame / 16) * 140,
      w: 18,
      h: 18,
      score: 0.7 + random() * 0.25,
    })
  }

  tracks['ball'] = {
    id: 99,
    team: 'ball',
    class: 'ball',
    jersey: null,
    positions: ballPositions,
  }

  return tracks
}

export function generateDemoAnalytics(tracks: Record<string, any>, frameId = 120): DemoAnalytics {
  const players = Object.values(tracks).filter((track) => track.class !== 'ball')
  const teamA = players.filter((track) => track.team === 'team_a').length
  const teamB = players.filter((track) => track.team === 'team_b').length
  const total = Math.max(teamA + teamB, 1)
  const teamAPercentage = (teamA / total) * 52 + 8
  const teamBPercentage = 100 - teamAPercentage
  const totalPasses = Math.max(8, players.length * 2)
  const successfulPasses = Math.floor(totalPasses * 0.84)

  const tracking_data = Object.values(tracks).map((track) => {
    const positions = Array.isArray(track.positions) ? track.positions : []
    const pos = positions[Math.min(frameId, Math.max(positions.length - 1, 0))] || {
      x: 100,
      y: 100,
      w: 40,
      h: 80,
      score: 0.8,
    }
    return {
      track_id: track.id,
      bbox: [pos.x, pos.y, pos.w, pos.h],
      class: track.class || 'person',
      confidence: pos.score,
      center: [pos.x + pos.w / 2, pos.y + pos.h / 2],
    }
  })

  return {
    frame_id: frameId,
    possession_stats: {
      team_a_possession: teamAPercentage * 0.32,
      team_b_possession: teamBPercentage * 0.32,
      team_a_percentage: teamAPercentage,
      team_b_percentage: teamBPercentage,
      total_possession_time: 30,
      possession_events: players.length,
      passes: totalPasses,
      current_possession: null,
    },
    pass_stats: {
      total_passes: totalPasses,
      successful_passes: successfulPasses,
      pass_success_rate: (successfulPasses / totalPasses) * 100,
      team_a_passes: Math.floor(totalPasses * 0.47),
      team_b_passes: Math.ceil(totalPasses * 0.53),
      recent_passes: Array.from({ length: 5 }, (_, index) => ({
        from_player: index,
        to_player: (index + 3) % Math.max(players.length, 1),
        successful: index !== 3,
        timestamp: Date.now() / 1000 - index * 2,
        distance: 60 + index * 18,
        team: index % 2 === 0 ? 'team_a' : 'team_b',
      })),
    },
    tracking_data,
    timestamp: Date.now() / 1000,
  }
}

export async function runDemoJob(onProgress: (pct: number) => void) {
  for (let pct = 0; pct <= 100; pct += 8) {
    onProgress(Math.min(pct, 100))
    await new Promise((resolve) => setTimeout(resolve, 90))
  }
  const tracks = generateDemoTracks()
  return {
    tracks,
    analytics: generateDemoAnalytics(tracks),
    totalFrames: 240,
  }
}
