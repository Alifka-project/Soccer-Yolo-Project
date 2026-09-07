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
  extent,
  height = 'h-16',
}: {
  positions: Array<{ x: number; y: number }>
  color: string
  /** Shared coordinate frame, so every grid is comparable with every other. */
  extent: { minX: number; minY: number; maxX: number; maxY: number }
  height?: string
}) {
  const COLS = 12
  const ROWS = 8
  const rangeX = Math.max(extent.maxX - extent.minX, 1)
  const rangeY = Math.max(extent.maxY - extent.minY, 1)
  const grid = new Array(COLS * ROWS).fill(0)

  // Counted in a single pass. Math.min(...points) would spread tens of
  // thousands of arguments once a clip has been running a while, which
  // overflows the call stack.
  let occupied = 0
  for (const point of positions) {
    const col = Math.min(COLS - 1, Math.max(0, Math.floor(((point.x - extent.minX) / rangeX) * COLS)))
    const row = Math.min(ROWS - 1, Math.max(0, Math.floor(((point.y - extent.minY) / rangeY) * ROWS)))
    const index = row * COLS + col
    if (grid[index] === 0) occupied++
    grid[index]++
  }

  let maxCount = 1
  for (const count of grid) if (count > maxCount) maxCount = count

  return (
    <div>
      <div className={`grid grid-cols-12 gap-0.5 ${height} bg-emerald-950/10 rounded p-1`}>
        {grid.map((count, i) => {
          const opacity = count > 0 ? (count / maxCount) * 0.85 + 0.15 : 0.04
          return (
            <div
              key={i}
              className="rounded-sm"
              title={count > 0 ? `${count} samples` : 'no samples'}
              style={{ backgroundColor: `rgba(${color}, ${opacity})` }}
            />
          )
        })}
      </div>
      <div className="mt-1 text-[10px] text-gray-400">
        {positions.length} samples · {occupied}/{COLS * ROWS} cells · peak {maxCount}
      </div>
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
  const extent = derived.heatmaps.extent
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
            <HeatmapGrid positions={overallPoints} color="16, 185, 129" extent={extent} height="h-36" />
            <p className="mt-2 text-[11px] text-gray-500">
              Camera view, not a pitch map. Cells are positions in the frame, so a
              panning camera moves the picture with it — read it as where play sat
              on screen rather than as fixed pitch locations.
            </p>
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
                  <HeatmapGrid positions={teamHeatmap.points} color={rgbTuple(color)} extent={extent} height="h-24" />
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
                  <HeatmapGrid positions={heatmap.points} color={rgbTuple(color)} extent={extent} />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
