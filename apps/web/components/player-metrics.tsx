'use client'

import { useEffect, useState } from 'react'
import { useSessionStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'

interface PlayerData {
  id: string
  positions: Array<{
    frame: number
    x: number
    y: number
    w: number
    h: number
    score: number
  }>
  team?: string
  jersey?: number
  totalDistance?: number
  avgSpeed?: number
  timeOnField?: number
}

export function PlayerMetrics() {
  const { processingStatus, tracks, progress, analyticsData, isRealtimeMode } = useSessionStore()
  const [localAnalytics, setLocalAnalytics] = useState(analyticsData)
  const [playerStats, setPlayerStats] = useState<Map<string, PlayerData>>(new Map())

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
    // Calculate player statistics from tracking data
    const calculatePlayerStats = () => {
      const stats = new Map<string, PlayerData>()
      
      // Process completed tracking data
      if (tracks.size > 0) {
        tracks.forEach((track, id) => {
          const positions = track.positions || []
          let totalDistance = 0
          
          // Calculate distance traveled
          for (let i = 1; i < positions.length; i++) {
            const prev = positions[i - 1]
            const curr = positions[i]
            const distance = Math.sqrt(
              Math.pow(curr.x - prev.x, 2) + Math.pow(curr.y - prev.y, 2)
            )
            totalDistance += distance
          }
          
          const timeOnField = positions.length * (1/30) // Assuming 30 FPS
          const avgSpeed = timeOnField > 0 ? totalDistance / timeOnField : 0
          
          stats.set(id, {
            id,
            positions,
            team: track.team || 'unknown',
            jersey: track.jersey,
            totalDistance: Math.round(totalDistance),
            avgSpeed: Math.round(avgSpeed * 100) / 100,
            timeOnField: Math.round(timeOnField)
          })
        })
      }
      
      // Process real-time analytics data
      const currentAnalytics = localAnalytics || analyticsData
      if (currentAnalytics?.tracking_data && isRealtimeMode) {
        currentAnalytics.tracking_data.forEach((obj: any) => {
          const existingStats = stats.get(obj.track_id.toString()) || {
            id: obj.track_id.toString(),
            positions: [] as any[],
            team: 'unknown'
          }
          
          // Update with latest position
          existingStats.positions.push({
            frame: currentAnalytics.frame_id,
            x: obj.bbox[0],
            y: obj.bbox[1],
            w: obj.bbox[2],
            h: obj.bbox[3],
            score: obj.confidence
          })
          
          stats.set(obj.track_id.toString(), existingStats)
        })
      }
      
      setPlayerStats(stats)
    }
    
    calculatePlayerStats()
  }, [tracks, localAnalytics, analyticsData, isRealtimeMode])

  const hasData = tracks.size > 0 || (localAnalytics && isRealtimeMode)

  if (!hasData) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
            Player Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500 text-sm">
            {processingStatus === 'processing' 
              ? `Processing... ${progress}%` 
              : 'Start tracking to see player metrics'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-lg">Player Metrics</h3>
        <Badge variant="secondary">
          {playerStats.size} Players
        </Badge>
      </div>

      {processingStatus === 'processing' && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Processing video...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {Array.from(playerStats.entries()).map(([id, player]) => (
          <Card key={id} className="border-l-4 border-l-blue-500">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  Player {id}
                </div>
                <div className="flex gap-1">
                  <Badge variant="outline" className="text-xs">
                    {player.team}
                  </Badge>
                  {player.jersey && (
                    <Badge variant="secondary" className="text-xs">
                      #{player.jersey}
                    </Badge>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <div className="text-gray-600">Positions Tracked</div>
                  <div className="font-medium">{player.positions.length} frames</div>
                </div>
                <div className="space-y-1">
                  <div className="text-gray-600">Time on Field</div>
                  <div className="font-medium">{player.timeOnField}s</div>
                </div>
                <div className="space-y-1">
                  <div className="text-gray-600">Distance</div>
                  <div className="font-medium">{player.totalDistance}px</div>
                </div>
                <div className="space-y-1">
                  <div className="text-gray-600">Avg Speed</div>
                  <div className="font-medium">{player.avgSpeed} px/s</div>
                </div>
              </div>
              
              {player.positions.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Latest Position</span>
                    <span>Frame {player.positions[player.positions.length - 1]?.frame || 0}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    ({Math.round(player.positions[player.positions.length - 1]?.x || 0)}, {Math.round(player.positions[player.positions.length - 1]?.y || 0)})
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {playerStats.size === 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-gray-500 text-sm text-center">
              No player data available yet
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
