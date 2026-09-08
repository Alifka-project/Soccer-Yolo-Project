'use client'

import { useDerivedAnalytics } from '@/lib/use-derived-analytics'
import { fmt, rgbaFromHex } from '@/lib/analytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { TeamLegend } from '@/components/team-legend'

export function TeamShape() {
  const { derived, processingStatus, progress } = useDerivedAnalytics()

  if (!derived.ready) {
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
            {processingStatus === 'processing' ? `Processing... ${progress}%` : 'Press play — formation is read from live player positions'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const { teamA, teamB } = derived.team
  const colorA = derived.teamColors.team_a
  const colorB = derived.teamColors.team_b

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-lg">Team Shape</h3>
        <Badge variant="secondary">{teamA.count + teamB.count} on pitch</Badge>
      </div>
      <TeamLegend colors={derived.teamColors} labels={derived.teamLabels} />

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

      <div className="grid grid-cols-2 gap-4">
        <Card className="border-l-4" style={{ borderLeftColor: colorA }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: colorA }}>{derived.teamLabels.team_a}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-center">
            <div className="text-2xl font-bold" style={{ color: colorA }}>{teamA.name}</div>
            <div className="text-xs text-gray-500">{teamA.count} players · {derived.extras.compactnessA} m² covered</div>
          </CardContent>
        </Card>
        <Card className="border-l-4" style={{ borderLeftColor: colorB }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: colorB }}>{derived.teamLabels.team_b}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-center">
            <div className="text-2xl font-bold" style={{ color: colorB }}>{teamB.name}</div>
            <div className="text-xs text-gray-500">{teamB.count} players · {derived.extras.compactnessB} m² covered</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Team Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="space-y-2 p-2 rounded-lg" style={{ background: rgbaFromHex(colorA, 0.1) }}>
              <div className="font-medium" style={{ color: colorA }}>{derived.teamLabels.team_a}</div>
              <div className="flex justify-between"><span>Width</span><span className="tabular-nums">{fmt(teamA.widthM, 0)} m</span></div>
              <div className="flex justify-between"><span>Depth</span><span className="tabular-nums">{fmt(teamA.depthM, 0)} m</span></div>
              <div className="flex justify-between"><span>Attacking third</span><span className="tabular-nums">{fmt(derived.extras.attackingThirdA, 0)}%</span></div>
            </div>
            <div className="space-y-2 p-2 rounded-lg" style={{ background: rgbaFromHex(colorB, 0.1) }}>
              <div className="font-medium" style={{ color: colorB }}>{derived.teamLabels.team_b}</div>
              <div className="flex justify-between"><span>Width</span><span className="tabular-nums">{fmt(teamB.widthM, 0)} m</span></div>
              <div className="flex justify-between"><span>Depth</span><span className="tabular-nums">{fmt(teamB.depthM, 0)} m</span></div>
              <div className="flex justify-between"><span>Attacking third</span><span className="tabular-nums">{fmt(derived.extras.attackingThirdB, 0)}%</span></div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Formation Overview</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-gray-600 space-y-1">
          <div className="flex justify-between">
            <span>{derived.teamLabels.team_a}</span>
            <span>{teamA.name} ({teamA.count}) · attacking {derived.team.aDefendsLowX ? 'right' : 'left'}</span>
          </div>
          <div className="flex justify-between">
            <span>{derived.teamLabels.team_b}</span>
            <span>{teamB.name} ({teamB.count}) · attacking {derived.team.aDefendsLowX ? 'left' : 'right'}</span>
          </div>
          <div className="flex justify-between"><span>Team Separation</span><span className="tabular-nums">{fmt(derived.team.separationM, 0)} m</span></div>
        </CardContent>
      </Card>
    </div>
  )
}
