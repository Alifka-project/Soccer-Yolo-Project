import { NextRequest, NextResponse } from 'next/server'

// In-memory storage
const sessions: Map<string, any> = new Map()

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const sessionId = params.sessionId
    
    if (!sessions.has(sessionId)) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }
    
    const session = sessions.get(sessionId)
    const tracks = session.tracks || {}
    
    // Generate analytics from tracking data
    const analytics = generateAnalytics(tracks)
    
    return NextResponse.json(analytics)
  } catch (error) {
    console.error('Analytics error:', error)
    return NextResponse.json(
      { error: 'Failed to generate analytics' },
      { status: 500 }
    )
  }
}

function generateAnalytics(tracks: Record<string, any>) {
  const trackCount = Object.keys(tracks).length
  
  // Generate possession stats based on track data
  const teamA = Object.values(tracks).filter((track: any) => track.team === 'team_a')
  const teamB = Object.values(tracks).filter((track: any) => track.team === 'team_b')
  
  const teamAActivity = teamA.length * 0.6 // Simulate possession
  const teamBActivity = teamB.length * 0.4
  
  const totalActivity = teamAActivity + teamBActivity
  const teamAPercentage = totalActivity > 0 ? (teamAActivity / totalActivity) * 100 : 50
  const teamBPercentage = totalActivity > 0 ? (teamBActivity / totalActivity) * 100 : 50
  
  // Generate pass stats
  const totalPasses = Math.max(5, trackCount * 2)
  const successfulPasses = Math.floor(totalPasses * 0.85)
  
  return {
    frame_id: Math.floor(Math.random() * 1000),
    possession_stats: {
      team_a_possession: teamAPercentage * 0.3, // seconds
      team_b_possession: teamBPercentage * 0.3,
      team_a_percentage: teamAPercentage,
      team_b_percentage: teamBPercentage,
      total_possession_time: 30.0,
      possession_events: trackCount,
      passes: totalPasses,
      current_possession: null
    },
    pass_stats: {
      total_passes: totalPasses,
      successful_passes: successfulPasses,
      pass_success_rate: (successfulPasses / totalPasses) * 100,
      team_a_passes: Math.floor(totalPasses * 0.45),
      team_b_passes: Math.floor(totalPasses * 0.55),
      recent_passes: generateRecentPasses(trackCount)
    },
    tracking_data: Object.values(tracks).map((track: any) => ({
      track_id: track.id,
      bbox: [100, 100, 50, 100],
      class: 'person',
      confidence: 0.8,
      center: [125, 150]
    })),
    timestamp: Date.now() / 1000
  }
}

function generateRecentPasses(trackCount: number) {
  const passes = []
  for (let i = 0; i < Math.min(5, trackCount); i++) {
    passes.push({
      from_player: i,
      to_player: (i + 1) % trackCount,
      successful: Math.random() > 0.2,
      timestamp: Date.now() - i * 2000,
      distance: Math.random() * 200 + 50,
      team: i % 2 === 0 ? 'team_a' : 'team_b'
    })
  }
  return passes
}
