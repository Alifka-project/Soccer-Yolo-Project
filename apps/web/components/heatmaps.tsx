'use client'

import { useEffect, useState } from 'react'
import { useSessionStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'

interface HeatmapData {
  x: number
  y: number
  intensity: number
}

interface PlayerHeatmap {
  playerId: string
  positions: HeatmapData[]
  totalTime: number
  avgIntensity: number
}

interface TeamHeatmap {
  team: string
  positions: HeatmapData[]
  density: number
}

export function Heatmaps() {
  const { processingStatus, tracks, progress, analyticsData, isRealtimeMode } = useSessionStore()
  const [localAnalytics, setLocalAnalytics] = useState(analyticsData)
  const [playerHeatmaps, setPlayerHeatmaps] = useState<Map<string, PlayerHeatmap>>(new Map())
  const [teamHeatmaps, setTeamHeatmaps] = useState<TeamHeatmap[]>([])
  const [selectedView, setSelectedView] = useState<'players' | 'teams' | 'overall'>('players')

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
    const calculateHeatmaps = () => {
      if (!tracks.size && !analyticsData) return

      const currentAnalytics = localAnalytics || analyticsData
      const playerMaps = new Map<string, PlayerHeatmap>()
      const teamMaps = new Map<string, HeatmapData[]>()
      const overallPositions: HeatmapData[] = []

      // Process completed tracking data
      if (tracks.size > 0) {
        tracks.forEach((track, id) => {
          const positions = track.positions || []
          const heatmapPositions: HeatmapData[] = positions.map((pos: any) => ({
            x: pos.x + pos.w / 2,
            y: pos.y + pos.h / 2,
            intensity: pos.score || 1
          }))

          playerMaps.set(id, {
            playerId: id,
            positions: heatmapPositions,
            totalTime: positions.length * (1/30), // Assuming 30 FPS
            avgIntensity: heatmapPositions.reduce((sum, p) => sum + p.intensity, 0) / heatmapPositions.length
          })

          // Add to overall positions
          overallPositions.push(...heatmapPositions)

          // Add to team positions
          const team = track.team || 'unknown'
          if (!teamMaps.has(team)) {
            teamMaps.set(team, [])
          }
          teamMaps.get(team)!.push(...heatmapPositions)
        })
      }

      // Process real-time analytics data
      if (currentAnalytics?.tracking_data && isRealtimeMode) {
        currentAnalytics.tracking_data.forEach((obj: any) => {
          const playerId = obj.track_id.toString()
          const position = {
            x: obj.bbox[0] + obj.bbox[2] / 2,
            y: obj.bbox[1] + obj.bbox[3] / 2,
            intensity: obj.confidence || 1
          }

          // Update player heatmap
          const existing = playerMaps.get(playerId) || {
            playerId,
            positions: [] as HeatmapData[],
            totalTime: 0,
            avgIntensity: 0
          }
          existing.positions.push(position)
          existing.totalTime += 1/30
          existing.avgIntensity = existing.positions.reduce((sum, p) => sum + p.intensity, 0) / existing.positions.length
          playerMaps.set(playerId, existing)

          // Add to overall and team positions
          overallPositions.push(position)
          const team = 'unknown' // Real-time doesn't have team info yet
          if (!teamMaps.has(team)) {
            teamMaps.set(team, [])
          }
          teamMaps.get(team)!.push(position)
        })
      }

      setPlayerHeatmaps(playerMaps)

      // Create team heatmaps
      const teamHeatmapData: TeamHeatmap[] = Array.from(teamMaps.entries()).map(([team, positions]) => ({
        team,
        positions,
        density: positions.length
      }))

      setTeamHeatmaps(teamHeatmapData)
    }

    calculateHeatmaps()
  }, [tracks, localAnalytics, analyticsData, isRealtimeMode])

  const hasData = tracks.size > 0 || (localAnalytics && isRealtimeMode)

  if (!hasData) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
            Heatmaps
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500 text-sm">
            {processingStatus === 'processing' 
              ? `Processing... ${progress}%` 
              : 'Start tracking to see heatmaps'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-lg">Heatmaps</h3>
        <div className="flex gap-1">
          <Badge 
            variant={selectedView === 'players' ? 'default' : 'outline'} 
            className="cursor-pointer text-xs"
            onClick={() => setSelectedView('players')}
          >
            Players
          </Badge>
          <Badge 
            variant={selectedView === 'teams' ? 'default' : 'outline'} 
            className="cursor-pointer text-xs"
            onClick={() => setSelectedView('teams')}
          >
            Teams
          </Badge>
          <Badge 
            variant={selectedView === 'overall' ? 'default' : 'outline'} 
            className="cursor-pointer text-xs"
            onClick={() => setSelectedView('overall')}
          >
            Overall
          </Badge>
        </div>
      </div>

      {processingStatus === 'processing' && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Generating heatmaps...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          </CardContent>
        </Card>
      )}

      {selectedView === 'players' && (
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {Array.from(playerHeatmaps.entries()).map(([id, heatmap]) => (
            <Card key={id} className="border-l-4 border-l-purple-500">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                    Player {id} Heatmap
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {heatmap.positions.length} points
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1">
                    <div className="text-gray-600">Data Points</div>
                    <div className="font-medium">{heatmap.positions.length}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-gray-600">Total Time</div>
                    <div className="font-medium">{Math.round(heatmap.totalTime)}s</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-gray-600">Avg Intensity</div>
                    <div className="font-medium">{heatmap.avgIntensity.toFixed(2)}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-gray-600">Coverage</div>
                    <div className="font-medium">
                      {heatmap.positions.length > 0 ? 'Active' : 'Limited'}
                    </div>
                  </div>
                </div>

                {/* Simple heatmap visualization */}
                <div className="mt-3 pt-3 border-t">
                  <div className="text-xs text-gray-500 mb-2">Position Distribution</div>
                  <div className="grid grid-cols-10 gap-1 h-16 bg-gray-100 rounded p-1">
                    {Array.from({ length: 100 }, (_, i) => {
                      const col = i % 10
                      const row = Math.floor(i / 10)
                      const cellPositions = heatmap.positions.filter(p => {
                        const xZone = Math.floor(p.x / 100) % 10
                        const yZone = Math.floor(p.y / 100) % 10
                        return xZone === col && yZone === row
                      })
                      const intensity = Math.min(cellPositions.length / 5, 1)
                      const opacity = intensity * 0.8 + 0.2
                      return (
                        <div
                          key={i}
                          className="rounded-sm"
                          style={{
                            backgroundColor: `rgba(147, 51, 234, ${opacity})`,
                            opacity: cellPositions.length > 0 ? 1 : 0.1
                          }}
                        />
                      )
                    })}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Purple intensity = player activity
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedView === 'teams' && (
        <div className="space-y-3">
          {teamHeatmaps.map((teamHeatmap, index) => (
            <Card key={index} className="border-l-4 border-l-green-500">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    Team {teamHeatmap.team} Heatmap
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {teamHeatmap.positions.length} points
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div className="space-y-1">
                    <div className="text-gray-600">Data Points</div>
                    <div className="font-medium">{teamHeatmap.positions.length}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-gray-600">Density</div>
                    <div className="font-medium">{teamHeatmap.density}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-gray-600">Coverage</div>
                    <div className="font-medium">Team-wide</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedView === 'overall' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Overall Field Heatmap</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-gray-600 mb-3">
              Combined player movement across the field
            </div>
            <div className="grid grid-cols-10 gap-1 h-32 bg-gray-100 rounded p-2">
              {Array.from({ length: 100 }, (_, i) => {
                const col = i % 10
                const row = Math.floor(i / 10)
                const allPositions = Array.from(playerHeatmaps.values()).flatMap(h => h.positions)
                const cellPositions = allPositions.filter(p => {
                  const xZone = Math.floor(p.x / 100) % 10
                  const yZone = Math.floor(p.y / 100) % 10
                  return xZone === col && yZone === row
                })
                const intensity = Math.min(cellPositions.length / 10, 1)
                const opacity = intensity * 0.8 + 0.2
                return (
                  <div
                    key={i}
                    className="rounded-sm"
                    style={{
                      backgroundColor: `rgba(59, 130, 246, ${opacity})`,
                      opacity: cellPositions.length > 0 ? 1 : 0.1
                    }}
                  />
                )
              })}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              Blue intensity = combined player activity
            </div>
          </CardContent>
        </Card>
      )}

      {playerHeatmaps.size === 0 && teamHeatmaps.length === 0 && hasData && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-gray-500 text-sm text-center">
              Generating heatmap data...
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
