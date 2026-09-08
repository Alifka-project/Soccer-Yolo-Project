'use client'

import { useDerivedAnalytics } from '@/lib/use-derived-analytics'
import { fmt, rgbaFromHex, teamLabel } from '@/lib/analytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { TeamLegend } from '@/components/team-legend'

export function PlayerMetrics() {
  const { derived, processingStatus, progress } = useDerivedAnalytics()

  if (!derived.ready) {
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
            {processingStatus === 'processing' ? `Processing... ${progress}%` : 'Press play — per-player metrics accumulate live'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-lg">Player Metrics</h3>
        <Badge variant="secondary">
          {derived.playerCount} on pitch
          {derived.playersSeen > derived.playerCount ? ` · ${derived.playersSeen} seen` : ''}
        </Badge>
      </div>
      <TeamLegend colors={derived.teamColors} labels={derived.teamLabels} />

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
        {derived.players.map((player) => {
          const color = player.color || (player.team === 'team_b' ? derived.teamColors.team_b : derived.teamColors.team_a)
          const label = teamLabel(player.team, derived.teamLabels)
          return (
            <Card key={player.id} className="border-l-4" style={{ borderLeftColor: color }}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }}></div>
                    Player {player.label ?? player.id}
                  </div>
                  <div className="flex gap-1">
                    <Badge variant="outline" className="text-xs" style={{ color, borderColor: color, background: rgbaFromHex(color, 0.1) }}>
                      {label}
                    </Badge>
                    {player.jersey ? (
                      <Badge variant="secondary" className="text-xs">#{player.jersey}</Badge>
                    ) : null}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="text-gray-600">Distance</div>
                    <div className="font-medium tabular-nums">{fmt(player.distanceM, 0)} m</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Time on Field</div>
                    <div className="font-medium tabular-nums">{fmt(player.timeOnField, 0)}s</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Avg Speed</div>
                    <div className="font-medium tabular-nums">{fmt(player.avgSpeedM)} m/s</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Max / Sprints</div>
                    <div className="font-medium tabular-nums">{fmt(player.maxSpeedM)} m/s · {player.sprints}</div>
                  </div>
                </div>
                {player.lastPosition && (
                  <div className="mt-3 pt-3 border-t text-xs text-gray-500">
                    Latest: ({Math.round(player.lastPosition.x)}, {Math.round(player.lastPosition.y)}) · Frame {player.lastPosition.frame}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
