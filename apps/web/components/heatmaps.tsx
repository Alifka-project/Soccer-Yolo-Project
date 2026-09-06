'use client'

import { useState } from 'react'
import { useDerivedAnalytics } from '@/lib/use-derived-analytics'
import { fmt, rgbTuple } from '@/lib/analytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { TeamLegend } from '@/components/team-legend'

function HeatmapGrid({
  positions,
  color,
  height = 'h-16',
}: {
  positions: Array<{ x: number; y: number }>
  color: string
  height?: string
}) {
  const COLS = 12
  const ROWS = 8
  const xs = positions.map((p) => p.x)
  const ys = positions.map((p) => p.y)
  const minX = xs.length ? Math.min(...xs) : 0
  const maxX = xs.length ? Math.max(...xs) : 1
  const minY = ys.length ? Math.min(...ys) : 0
  const maxY = ys.length ? Math.max(...ys) : 1
  const rangeX = Math.max(maxX - minX, 1)
  const rangeY = Math.max(maxY - minY, 1)
  const grid = new Array(COLS * ROWS).fill(0)

  positions.forEach((p) => {
    const col = Math.min(COLS - 1, Math.floor(((p.x - minX) / rangeX) * COLS))
    const row = Math.min(ROWS - 1, Math.floor(((p.y - minY) / rangeY) * ROWS))
    grid[row * COLS + col]++
  })
  const maxCount = Math.max(1, ...grid)

  return (
    <div className={`grid grid-cols-12 gap-0.5 ${height} bg-emerald-950/10 rounded p-1`}>
      {grid.map((count, i) => {
        const opacity = count > 0 ? (count / maxCount) * 0.85 + 0.15 : 0.04
        return (
          <div
            key={i}
            className="rounded-sm"
            style={{ backgroundColor: `rgba(${color}, ${opacity})` }}
          />
        )
      })}
    </div>
  )
}

export function Heatmaps() {
  const { derived, processingStatus, progress } = useDerivedAnalytics()
  const [selectedView, setSelectedView] = useState<'players' | 'teams' | 'overall'>('overall')

  if (!derived.ready) {
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
            {processingStatus === 'processing' ? `Processing... ${progress}%` : 'Press play — heatmaps build as the video runs'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const overallPoints = derived.heatmaps.players.flatMap((player) => player.points)
  const colorA = derived.teamColors.team_a
  const colorB = derived.teamColors.team_b

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-lg">Heatmaps</h3>
        <div className="flex gap-1">
          {(['overall', 'teams', 'players'] as const).map((view) => (
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

      {selectedView === 'overall' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Overall Field Heatmap</CardTitle>
          </CardHeader>
          <CardContent>
            <HeatmapGrid positions={overallPoints} color="16, 185, 129" height="h-36" />
            <div className="text-xs text-gray-500 mt-2">{overallPoints.length} position samples</div>
          </CardContent>
        </Card>
      )}

      {selectedView === 'teams' && (
        <div className="space-y-3">
          {derived.heatmaps.teams.map((teamHeatmap) => {
            const color = teamHeatmap.team === 'team_b' ? colorB : teamHeatmap.team === 'team_a' ? colorA : '#6B7280'
            const label = teamHeatmap.team === 'team_a'
              ? derived.teamLabels.team_a
              : teamHeatmap.team === 'team_b'
                ? derived.teamLabels.team_b
                : teamHeatmap.team
            return (
              <Card key={teamHeatmap.team} className="border-l-4" style={{ borderLeftColor: color }}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                      {label}
                    </span>
                    <Badge variant="outline" className="text-xs">{teamHeatmap.points.length} points</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <HeatmapGrid positions={teamHeatmap.points} color={rgbTuple(color)} height="h-24" />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {selectedView === 'players' && (
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {derived.heatmaps.players.map((heatmap) => {
            const color = heatmap.team === 'team_b' ? colorB : heatmap.team === 'team_a' ? colorA : '#7C3AED'
            return (
              <Card key={heatmap.id} className="border-l-4" style={{ borderLeftColor: color }}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span>Player {heatmap.id}</span>
                    <Badge variant="outline" className="text-xs">{heatmap.points.length} points</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                    <div>Time {fmt(heatmap.timeOnField, 0)}s</div>
                    <div className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                      {heatmap.team === 'team_a' ? derived.teamLabels.team_a : heatmap.team === 'team_b' ? derived.teamLabels.team_b : heatmap.team}
                    </div>
                  </div>
                  <HeatmapGrid positions={heatmap.points} color={rgbTuple(color)} />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
