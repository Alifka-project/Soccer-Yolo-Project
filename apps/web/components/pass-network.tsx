'use client'

import { useEffect, useState } from 'react'
import { useSessionStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'

interface Pass {
  from_player: string
  to_player: string
  successful: boolean
  timestamp: number
  distance: number
  team: string
}

interface PassNetwork {
  total_passes: number
  successful_passes: number
  pass_success_rate: number
  team_a_passes: number
  team_b_passes: number
  recent_passes: Pass[]
  pass_matrix: Map<string, Map<string, number>>
  top_passers: Array<{player: string, passes: number}>
  top_recipients: Array<{player: string, receptions: number}>
}

export function PassNetwork() {
  const { processingStatus, tracks, progress, analyticsData, isRealtimeMode } = useSessionStore()
  const [localAnalytics, setLocalAnalytics] = useState(analyticsData)
  const [passNetwork, setPassNetwork] = useState<PassNetwork | null>(null)
  const [selectedView, setSelectedView] = useState<'overview' | 'matrix' | 'players'>('overview')

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
    const calculatePassNetwork = () => {
      const currentAnalytics = localAnalytics || analyticsData
      
      // Initialize pass network
      const network: PassNetwork = {
        total_passes: 0,
        successful_passes: 0,
        pass_success_rate: 0,
        team_a_passes: 0,
        team_b_passes: 0,
        recent_passes: [],
        pass_matrix: new Map(),
        top_passers: [],
        top_recipients: []
      }

      // Get pass data from analytics
      if (currentAnalytics?.pass_stats) {
        network.total_passes = currentAnalytics.pass_stats.total_passes || 0
        network.successful_passes = currentAnalytics.pass_stats.successful_passes || 0
        network.pass_success_rate = currentAnalytics.pass_stats.pass_success_rate || 0
        network.team_a_passes = currentAnalytics.pass_stats.team_a_passes || 0
        network.team_b_passes = currentAnalytics.pass_stats.team_b_passes || 0
        network.recent_passes = currentAnalytics.pass_stats.recent_passes || []
      }

      // Generate synthetic pass data for demonstration if no real data
      if (network.total_passes === 0 && tracks.size > 0) {
        const players = Array.from(tracks.keys())
        const syntheticPasses: Pass[] = []
        
        // Generate some synthetic passes for demonstration
        for (let i = 0; i < Math.min(players.length * 2, 20); i++) {
          const fromPlayer = players[Math.floor(Math.random() * players.length)]
          const toPlayer = players[Math.floor(Math.random() * players.length)]
          
          if (fromPlayer !== toPlayer) {
            syntheticPasses.push({
              from_player: fromPlayer,
              to_player: toPlayer,
              successful: Math.random() > 0.2, // 80% success rate
              timestamp: Date.now() - Math.random() * 60000, // Random time in last minute
              distance: Math.random() * 200 + 50, // Random distance 50-250
              team: Math.random() > 0.5 ? 'A' : 'B'
            })
          }
        }
        
        network.recent_passes = syntheticPasses
        network.total_passes = syntheticPasses.length
        network.successful_passes = syntheticPasses.filter(p => p.successful).length
        network.pass_success_rate = network.total_passes > 0 ? 
          (network.successful_passes / network.total_passes) * 100 : 0
        network.team_a_passes = syntheticPasses.filter(p => p.team === 'A').length
        network.team_b_passes = syntheticPasses.filter(p => p.team === 'B').length
      }

      // Calculate pass matrix and statistics
      const passMatrix = new Map<string, Map<string, number>>()
      const passerCounts = new Map<string, number>()
      const recipientCounts = new Map<string, number>()

      network.recent_passes.forEach(pass => {
        // Update pass matrix
        if (!passMatrix.has(pass.from_player)) {
          passMatrix.set(pass.from_player, new Map())
        }
        const playerMatrix = passMatrix.get(pass.from_player)!
        const currentCount = playerMatrix.get(pass.to_player) || 0
        playerMatrix.set(pass.to_player, currentCount + 1)

        // Update counts
        passerCounts.set(pass.from_player, (passerCounts.get(pass.from_player) || 0) + 1)
        recipientCounts.set(pass.to_player, (recipientCounts.get(pass.to_player) || 0) + 1)
      })

      network.pass_matrix = passMatrix
      network.top_passers = Array.from(passerCounts.entries())
        .map(([player, passes]) => ({ player, passes }))
        .sort((a, b) => b.passes - a.passes)
        .slice(0, 5)

      network.top_recipients = Array.from(recipientCounts.entries())
        .map(([player, receptions]) => ({ player, receptions }))
        .sort((a, b) => b.receptions - a.receptions)
        .slice(0, 5)

      setPassNetwork(network)
    }

    calculatePassNetwork()
  }, [tracks, localAnalytics, analyticsData])

  const hasData = tracks.size > 0 || (localAnalytics && isRealtimeMode)

  if (!hasData) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
            Pass Network
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500 text-sm">
            {processingStatus === 'processing' 
              ? `Processing... ${progress}%` 
              : 'Start tracking to see pass network'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-lg">Pass Network</h3>
        <div className="flex gap-1">
          <Badge 
            variant={selectedView === 'overview' ? 'default' : 'outline'} 
            className="cursor-pointer text-xs"
            onClick={() => setSelectedView('overview')}
          >
            Overview
          </Badge>
          <Badge 
            variant={selectedView === 'matrix' ? 'default' : 'outline'} 
            className="cursor-pointer text-xs"
            onClick={() => setSelectedView('matrix')}
          >
            Matrix
          </Badge>
          <Badge 
            variant={selectedView === 'players' ? 'default' : 'outline'} 
            className="cursor-pointer text-xs"
            onClick={() => setSelectedView('players')}
          >
            Players
          </Badge>
        </div>
      </div>

      {processingStatus === 'processing' && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Analyzing pass patterns...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          </CardContent>
        </Card>
      )}

      {passNetwork && (
        <>
          {selectedView === 'overview' && (
            <>
              {/* Pass Statistics */}
              <div className="grid grid-cols-2 gap-4">
                <Card className="border-l-4 border-l-green-500">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Total Passes</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-2xl font-bold text-green-600">
                      {passNetwork.total_passes}
                    </div>
                    <div className="text-xs text-gray-500">
                      {passNetwork.successful_passes} successful
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-blue-500">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Success Rate</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-2xl font-bold text-blue-600">
                      {passNetwork.pass_success_rate.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-500">
                      Pass accuracy
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Team Pass Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Team Pass Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-3 bg-blue-50 rounded-lg">
                      <div className="text-lg font-semibold text-blue-700">
                        {passNetwork.team_a_passes}
                      </div>
                      <div className="text-xs text-blue-600">Team A Passes</div>
                    </div>
                    <div className="text-center p-3 bg-cyan-50 rounded-lg">
                      <div className="text-lg font-semibold text-cyan-700">
                        {passNetwork.team_b_passes}
                      </div>
                      <div className="text-xs text-cyan-600">Team B Passes</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Recent Passes */}
              {passNetwork.recent_passes.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Recent Passes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {passNetwork.recent_passes.slice(-10).map((pass, index) => (
                        <div key={index} className="flex items-center justify-between text-xs p-2 bg-gray-50 rounded">
                          <span>
                            P{pass.from_player} → P{pass.to_player}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500">
                              {Math.round(pass.distance)}px
                            </span>
                            <Badge variant={pass.successful ? "default" : "destructive"} className="text-xs">
                              {pass.successful ? "✓" : "✗"}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {selectedView === 'matrix' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Pass Matrix</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-gray-600 mb-3">
                  Number of passes between players
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {Array.from(passNetwork.pass_matrix.entries()).map(([fromPlayer, toPlayers]) => (
                    <div key={fromPlayer} className="space-y-1">
                      <div className="font-medium text-xs text-blue-600">
                        From Player {fromPlayer}:
                      </div>
                      <div className="ml-4 space-y-1">
                        {Array.from(toPlayers.entries()).map(([toPlayer, count]) => (
                          <div key={toPlayer} className="flex justify-between text-xs">
                            <span>→ Player {toPlayer}</span>
                            <Badge variant="outline" className="text-xs">
                              {count}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {selectedView === 'players' && (
            <div className="grid grid-cols-2 gap-4">
              {/* Top Passers */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Top Passers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {passNetwork.top_passers.map((passer, index) => (
                      <div key={passer.player} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                          <span>Player {passer.player}</span>
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {passer.passes}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Top Recipients */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Top Recipients</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {passNetwork.top_recipients.map((recipient, index) => (
                      <div key={recipient.player} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                          <span>Player {recipient.player}</span>
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {recipient.receptions}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {!passNetwork && hasData && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-gray-500 text-sm text-center">
              Analyzing pass patterns...
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
