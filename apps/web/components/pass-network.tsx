'use client'

import { useState } from 'react'
import { useDerivedAnalytics } from '@/lib/use-derived-analytics'
import { fmt, rgbaFromHex } from '@/lib/analytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { TeamLegend, TeamSwatchCard } from '@/components/team-legend'

export function PassNetwork() {
  const { derived, processingStatus, progress } = useDerivedAnalytics()
  const [selectedView, setSelectedView] = useState<'overview' | 'matrix' | 'players'>('overview')

  if (!derived.ready) {
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
            {processingStatus === 'processing' ? `Processing... ${progress}%` : 'Press play — the pass network builds as play develops'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const network = derived.passes
  const colorA = derived.teamColors.team_a
  const colorB = derived.teamColors.team_b

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-lg">Pass Network</h3>
        <div className="flex gap-1">
          {(['overview', 'matrix', 'players'] as const).map((view) => (
            <Badge
              key={view}
              variant={selectedView === view ? 'default' : 'outline'}
              className="cursor-pointer text-xs capitalize"
              onClick={() => setSelectedView(view)}
            >
              {view}
            </Badge>
          ))}
        </div>
      </div>
      <TeamLegend colors={derived.teamColors} labels={derived.teamLabels} />

      {processingStatus === 'processing' && (
        <Card>
          <CardContent className="pt-6">
            <Progress value={progress} className="h-2" />
          </CardContent>
        </Card>
      )}

      {!derived.ballDetected && (
        <p className="text-xs text-gray-500">
          Passes are inferred from ball possession changes. No ball track was found in this clip, so the network stays empty instead of showing fake data.
        </p>
      )}

      {selectedView === 'overview' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-l-4 border-l-green-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Total Passes</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-bold text-green-600 tabular-nums">{network.total_passes}</div>
                <div className="text-xs text-gray-500">{network.successful_passes} successful</div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-blue-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Success Rate</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-bold text-blue-600 tabular-nums">{fmt(network.pass_success_rate)}%</div>
                <div className="text-xs text-gray-500">Same-team ball transfers</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Team Pass Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <TeamSwatchCard color={colorA} label={derived.teamLabels.team_a} value={String(network.team_a_passes)} />
                <TeamSwatchCard color={colorB} label={derived.teamLabels.team_b} value={String(network.team_b_passes)} />
              </div>
            </CardContent>
          </Card>

          {network.recent_passes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Recent Passes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {network.recent_passes.slice(-10).map((pass, index) => {
                    const color = pass.team === 'team_b' ? colorB : colorA
                    return (
                      <div key={`${pass.from_player}-${pass.to_player}-${index}`} className="flex items-center justify-between text-xs p-2 rounded" style={{ background: rgbaFromHex(color, 0.1) }}>
                        <span>P{pass.from_player} → P{pass.to_player}</span>
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                          <span className="text-gray-500 tabular-nums">{fmt(pass.distance * derived.extras.metersPerPixel, 0)} m</span>
                          <Badge variant={pass.successful ? 'default' : 'destructive'} className="text-xs">
                            {pass.successful ? '✓' : '✗'}
                          </Badge>
                        </div>
                      </div>
                    )
                  })}
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
            {network.pass_matrix.length === 0 ? (
              <p className="text-xs text-gray-500">No completed passes to chart yet.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {network.pass_matrix.map((row) => (
                  <div key={`${row.from}-${row.to}`} className="flex justify-between text-xs">
                    <span>Player {row.from} → Player {row.to}</span>
                    <Badge variant="outline">{row.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selectedView === 'players' && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Top Passers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {network.top_passers.length === 0 && <p className="text-xs text-gray-500">No passers yet.</p>}
              {network.top_passers.map((passer) => (
                <div key={passer.player} className="flex items-center justify-between text-xs">
                  <span>Player {passer.player}</span>
                  <Badge variant="secondary">{passer.passes}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Top Recipients</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {network.top_recipients.length === 0 && <p className="text-xs text-gray-500">No recipients yet.</p>}
              {network.top_recipients.map((recipient) => (
                <div key={recipient.player} className="flex items-center justify-between text-xs">
                  <span>Player {recipient.player}</span>
                  <Badge variant="secondary">{recipient.receptions}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
