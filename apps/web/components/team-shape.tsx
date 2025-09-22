'use client'

import { useEffect, useState } from 'react'
import { useSessionStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'

interface Formation {
  name: string
  players: Array<{
    id: string
    x: number
    y: number
    role: string
  }>
}

interface TeamData {
  teamA: Formation
  teamB: Formation
  centerOfMass: {
    teamA: { x: number; y: number }
    teamB: { x: number; y: number }
  }
  teamWidth: {
    teamA: number
    teamB: number
  }
  teamDepth: {
    teamA: number
    teamB: number
  }
}

export function TeamShape() {
  const { processingStatus, tracks, progress, analyticsData, isRealtimeMode } = useSessionStore()
  const [localAnalytics, setLocalAnalytics] = useState(analyticsData)
  const [teamData, setTeamData] = useState<TeamData | null>(null)

  useEffect(() => {
    // Listen for analytics updates
    const handleAnalyticsUpdate = (event: CustomEvent) => {
      setLocalAnalytics(event.detail)
    }

    window.addEventListener('analyticsUpdate', handleAnalyticsUpdate as EventListener)
    
    return () => {
      window.removeEventListener('analyticsUpdate', handleAnalyticsUpdate as EventListener)
    }
  }, [])

  useEffect(() => {
    const calculateTeamShape = () => {
      if (!tracks.size && !analyticsData) return

      const currentAnalytics = localAnalytics || analyticsData
      let currentPositions: Array<{id: string, x: number, y: number, team: string}> = []

      // Get current positions from real-time data
      if (currentAnalytics?.tracking_data && isRealtimeMode) {
        currentPositions = currentAnalytics.tracking_data.map((obj: any) => ({
          id: obj.track_id.toString(),
          x: obj.bbox[0] + obj.bbox[2] / 2, // Center X
          y: obj.bbox[1] + obj.bbox[3] / 2, // Center Y
          team: 'unknown' // Will be determined later
        }))
      } else if (tracks.size > 0) {
        // Get latest positions from completed tracking
        tracks.forEach((track, id) => {
          const positions = track.positions || []
          if (positions.length > 0) {
            const lastPos = positions[positions.length - 1]
            currentPositions.push({
              id,
              x: lastPos.x + lastPos.w / 2,
              y: lastPos.y + lastPos.h / 2,
              team: track.team || 'unknown'
            })
          }
        })
      }

      if (currentPositions.length === 0) return

      // Split into teams (simple heuristic: left side vs right side)
      const sortedByX = currentPositions.sort((a, b) => a.x - b.x)
      const midX = sortedByX[Math.floor(sortedByX.length / 2)].x
      
      const teamA = sortedByX.filter(p => p.x < midX)
      const teamB = sortedByX.filter(p => p.x >= midX)

      // Calculate center of mass for each team
      const centerOfMassA = teamA.length > 0 ? {
        x: teamA.reduce((sum, p) => sum + p.x, 0) / teamA.length,
        y: teamA.reduce((sum, p) => sum + p.y, 0) / teamA.length
      } : { x: 0, y: 0 }

      const centerOfMassB = teamB.length > 0 ? {
        x: teamB.reduce((sum, p) => sum + p.x, 0) / teamB.length,
        y: teamB.reduce((sum, p) => sum + p.y, 0) / teamB.length
      } : { x: 0, y: 0 }

      // Calculate team width and depth
      const teamWidthA = teamA.length > 1 ? 
        Math.max(...teamA.map(p => p.x)) - Math.min(...teamA.map(p => p.x)) : 0
      const teamDepthA = teamA.length > 1 ? 
        Math.max(...teamA.map(p => p.y)) - Math.min(...teamA.map(p => p.y)) : 0

      const teamWidthB = teamB.length > 1 ? 
        Math.max(...teamB.map(p => p.x)) - Math.min(...teamB.map(p => p.x)) : 0
      const teamDepthB = teamB.length > 1 ? 
        Math.max(...teamB.map(p => p.y)) - Math.min(...teamB.map(p => p.y)) : 0

      // Determine formation based on player positions
      const determineFormation = (players: Array<{x: number, y: number}>, teamName: string) => {
        if (players.length === 0) return { name: 'Unknown', players: [] }
        
        // Simple formation detection based on Y positions
        const sortedByY = players.sort((a, b) => b.y - a.y) // Higher Y = further back
        
        let formation = 'Unknown'
        if (players.length >= 10) {
          // Count players in different vertical zones
          const zones = [0, 0, 0, 0] // Defense, Midfield, Attack, Forward
          const fieldHeight = 600 // Assuming field height
          const zoneHeight = fieldHeight / 4
          
          players.forEach(player => {
            const zone = Math.min(3, Math.floor(player.y / zoneHeight))
            zones[zone]++
          })
          
          // Simple formation logic
          if (zones[0] >= 3 && zones[1] >= 3) formation = '4-3-3'
          else if (zones[0] >= 4 && zones[1] >= 2) formation = '4-4-2'
          else if (zones[0] >= 3 && zones[1] >= 4) formation = '3-4-3'
          else formation = `${zones[0]}-${zones[1]}-${zones[2]}`
        }

        return {
          name: formation,
          players: players.map((player, index) => ({
            id: `${teamName}-${index}`,
            x: player.x,
            y: player.y,
            role: index < 4 ? 'Defender' : index < 7 ? 'Midfielder' : 'Forward'
          }))
        }
      }

      setTeamData({
        teamA: determineFormation(teamA, 'A'),
        teamB: determineFormation(teamB, 'B'),
        centerOfMass: {
          teamA: centerOfMassA,
          teamB: centerOfMassB
        },
        teamWidth: {
          teamA: Math.round(teamWidthA),
          teamB: Math.round(teamWidthB)
        },
        teamDepth: {
          teamA: Math.round(teamDepthA),
          teamB: Math.round(teamDepthB)
        }
      })
    }

    calculateTeamShape()
  }, [tracks, localAnalytics, analyticsData, isRealtimeMode])

  const hasData = tracks.size > 0 || (localAnalytics && isRealtimeMode)

  if (!hasData) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
            Team Shape
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500 text-sm">
            {processingStatus === 'processing' 
              ? `Processing... ${progress}%` 
              : 'Start tracking to see team formation'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-lg">Team Shape</h3>
        {teamData && (
          <Badge variant="secondary">
            {teamData.teamA.players.length + teamData.teamB.players.length} Players
          </Badge>
        )}
      </div>

      {processingStatus === 'processing' && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Analyzing team formation...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          </CardContent>
        </Card>
      )}

      {teamData && (
        <>
          {/* Team Formations */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-l-4 border-l-blue-500">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  Team A Formation
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {teamData.teamA.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {teamData.teamA.players.length} players
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-cyan-500">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 bg-cyan-500 rounded-full"></div>
                  Team B Formation
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-center">
                  <div className="text-2xl font-bold text-cyan-600">
                    {teamData.teamB.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {teamData.teamB.players.length} players
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Team Statistics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Team Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="text-xs font-medium text-blue-600">Team A</div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span>Width:</span>
                      <span>{teamData.teamWidth.teamA}px</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Depth:</span>
                      <span>{teamData.teamDepth.teamA}px</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Center X:</span>
                      <span>{Math.round(teamData.centerOfMass.teamA.x)}px</span>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div className="text-xs font-medium text-cyan-600">Team B</div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span>Width:</span>
                      <span>{teamData.teamWidth.teamB}px</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Depth:</span>
                      <span>{teamData.teamDepth.teamB}px</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Center X:</span>
                      <span>{Math.round(teamData.centerOfMass.teamB.x)}px</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Formation Visualization */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Formation Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-gray-600 space-y-1">
                <div className="flex justify-between">
                  <span>Team A:</span>
                  <span>{teamData.teamA.name} ({teamData.teamA.players.length} players)</span>
                </div>
                <div className="flex justify-between">
                  <span>Team B:</span>
                  <span>{teamData.teamB.name} ({teamData.teamB.players.length} players)</span>
                </div>
                <div className="flex justify-between">
                  <span>Team Separation:</span>
                  <span>{Math.round(Math.abs(teamData.centerOfMass.teamA.x - teamData.centerOfMass.teamB.x))}px</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!teamData && hasData && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-gray-500 text-sm text-center">
              Analyzing team positions...
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
