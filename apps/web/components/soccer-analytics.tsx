'use client'

import { useDerivedAnalytics } from '@/lib/use-derived-analytics'
import { fmt, rgbaFromHex, teamLabel } from '@/lib/analytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TeamLegend, TeamSwatchCard } from '@/components/team-legend'
import { AiInsights } from '@/components/ai-insights'

function possessionNote(source: string, coverage: number) {
  const pct = Math.round(coverage * 100)
  if (source === 'worker') return 'Reported by the YOLO26 worker'
  if (source === 'none') return 'Not enough tracking data yet'
  if (pct >= 95) return 'Ball tracked throughout · possession follows the ball'
  if (pct > 0) {
    return `Ball tracked in ${pct}% of sampled frames · play location fills the gaps`
  }
  return 'Ball not detected · possession estimated from where play is concentrated'
}

export function SoccerAnalytics() {
  const { derived, isRealtimeMode, processingStatus, analyticsData, liveStatus } = useDerivedAnalytics()

  if (!derived.ready) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
            Soccer Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500 text-sm">
            {processingStatus === 'processing'
              ? 'Processing video…'
              : liveStatus?.state === 'loading'
                ? 'Loading the vision model — analytics start the moment the video plays.'
                : liveStatus?.state === 'error'
                  ? `Live detector unavailable: ${liveStatus.message}`
                  : 'Upload a video and press play. Analytics stream while it runs — no job to start.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const possession = derived.possession
  const passes = derived.passes
  const colorA = derived.teamColors.team_a
  const colorB = derived.teamColors.team_b
  const collecting = possession.total_possession_time < 0.35
  const isLive = processingStatus === 'live'

  return (
    <div className="space-y-4 max-h-full overflow-y-auto">
      <TeamLegend colors={derived.teamColors} labels={derived.teamLabels} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            Ball Possession
            {isLive && (
              <span className="ml-auto flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                LIVE
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {collecting ? (
            <p className="text-sm text-gray-500">
              Collecting possession samples… percentages appear after about 0.4s of tracked control.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <TeamSwatchCard
                  color={colorA}
                  label={derived.teamLabels.team_a}
                  value={`${fmt(possession.team_a_percentage)}%`}
                  sublabel={`${fmt(possession.team_a_possession)}s`}
                />
                <TeamSwatchCard
                  color={colorB}
                  label={derived.teamLabels.team_b}
                  value={`${fmt(possession.team_b_percentage)}%`}
                  sublabel={`${fmt(possession.team_b_possession)}s`}
                />
              </div>
              <div className="h-3 rounded-full overflow-hidden flex bg-gray-100">
                <div className="h-full transition-all duration-300" style={{ width: `${possession.team_a_percentage}%`, backgroundColor: colorA }} />
                <div className="h-full transition-all duration-300" style={{ width: `${possession.team_b_percentage}%`, backgroundColor: colorB }} />
              </div>
            </>
          )}

          <p className="text-[11px] text-gray-500">
            {possessionNote(possession.source, derived.ballCoverage)}
          </p>

          {possession.current_possession && (
            <div className="mt-2 p-3 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium text-green-800">Current Possession</span>
              </div>
              <div className="text-xs text-green-600 mt-1">
                Player {possession.current_possession.player_id} ({teamLabel(possession.current_possession.team, derived.teamLabels)})
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
            Pass Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-xl font-bold text-gray-800 mb-1 tabular-nums">{passes.total_passes}</div>
              <div className="text-xs text-gray-600 font-medium">Attempted</div>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <div className="text-xl font-bold text-green-600 mb-1 tabular-nums">{passes.successful_passes}</div>
              <div className="text-xs text-gray-600 font-medium">Completed</div>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <div className="text-xl font-bold text-blue-600 mb-1 tabular-nums">{fmt(passes.pass_success_rate)}%</div>
              <div className="text-xs text-gray-600 font-medium">Success Rate</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TeamSwatchCard color={colorA} label={`${derived.teamLabels.team_a} passes`} value={String(passes.team_a_passes)} />
            <TeamSwatchCard color={colorB} label={`${derived.teamLabels.team_b} passes`} value={String(passes.team_b_passes)} />
          </div>
          <p className="text-[11px] text-gray-500">
            A pass is counted when control moves between players. Completions stay with
            the same team; a ball that travels and is picked up by the opposition is an
            intercepted attempt.
          </p>

          {passes.recent_passes.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Recent Passes</h4>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {passes.recent_passes.slice(-5).map((pass, index) => {
                  const color = pass.team === 'team_b' ? colorB : colorA
                  return (
                    <div key={`${pass.from_player}-${pass.to_player}-${index}`} className="flex items-center justify-between text-xs p-2 rounded" style={{ background: rgbaFromHex(color, 0.1) }}>
                      <span>P{pass.from_player} → P{pass.to_player}</span>
                      <Badge variant={pass.successful ? 'default' : 'destructive'} className="text-xs">
                        {pass.successful ? '✓' : '✗'}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
            Win Probability
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <TeamSwatchCard
              color={colorA}
              label={derived.teamLabels.team_a}
              value={`${fmt(derived.extras.winA, 0)}%`}
              sublabel="P(win)"
            />
            <TeamSwatchCard
              color={colorB}
              label={derived.teamLabels.team_b}
              value={`${fmt(derived.extras.winB, 0)}%`}
              sublabel="P(win)"
            />
          </div>
          <div className="h-3 rounded-full overflow-hidden flex bg-gray-100">
            <div className="h-full transition-all duration-300" style={{ width: `${derived.extras.winA}%`, backgroundColor: colorA }} />
            <div className="h-full transition-all duration-300" style={{ width: `${derived.extras.winB}%`, backgroundColor: colorB }} />
          </div>
          {derived.extras.winFactors.length > 0 ? (
            <div className="space-y-1.5 pt-1">
              <p className="text-[11px] font-medium text-gray-600">What is driving this</p>
              {derived.extras.winFactors.map((factor) => {
                const favoursA = factor.contribution > 0
                const strength = Math.min(100, Math.abs(factor.contribution) * 120)
                return (
                  <div key={factor.label} className="flex items-center gap-2 text-[11px]">
                    <span className="w-20 shrink-0 text-gray-600">{factor.label}</span>
                    <span className="relative h-1.5 flex-1 rounded-full bg-gray-100">
                      <span
                        className="absolute top-0 h-full rounded-full"
                        style={{
                          width: `${strength / 2}%`,
                          [favoursA ? 'right' : 'left']: '50%',
                          backgroundColor: favoursA ? colorA : colorB,
                        }}
                      />
                      <span className="absolute left-1/2 top-[-2px] h-[10px] w-px bg-gray-300" />
                    </span>
                    <span className="w-32 shrink-0 truncate text-right text-gray-500" title={factor.detail}>
                      {factor.detail}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-500">Not enough play tracked yet to separate the teams.</p>
          )}
          <p className="text-xs text-gray-500">
            {derived.extras.winConfidence === 'high' ? 'High confidence' : 'Live estimate'} · logistic model over the signals above
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
            Advanced Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-center">
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-lg font-bold tabular-nums">{derived.extras.sprints}</div>
            <div className="text-xs text-gray-600">Sprint bursts</div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-lg font-bold tabular-nums">{fmt(derived.team.separationM, 0)} m</div>
            <div className="text-xs text-gray-600">Team separation</div>
          </div>
          <div className="p-3 rounded-lg" style={{ background: rgbaFromHex(colorA, 0.12) }}>
            <div className="text-lg font-bold tabular-nums" style={{ color: colorA }}>{fmt(derived.extras.attackingThirdA, 0)}%</div>
            <div className="text-xs" style={{ color: colorA }}>A in attacking third</div>
          </div>
          <div className="p-3 rounded-lg" style={{ background: rgbaFromHex(colorB, 0.12) }}>
            <div className="text-lg font-bold tabular-nums" style={{ color: colorB }}>{fmt(derived.extras.attackingThirdB, 0)}%</div>
            <div className="text-xs" style={{ color: colorB }}>B in attacking third</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
            Tracking Info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-xl font-bold text-gray-800 mb-1 tabular-nums">{derived.playerCount}</div>
              <div className="text-xs text-gray-600 font-medium">Players Tracked</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-xl font-bold text-gray-800 mb-1 tabular-nums">{derived.frameId || 'N/A'}</div>
              <div className="text-xs text-gray-600 font-medium">Current Frame</div>
            </div>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg text-xs text-gray-600">
            {derived.ballDetected ? 'Ball track available' : 'Ball not detected yet'}
            {analyticsData?.timestamp
              ? ` · Updated ${new Date(analyticsData.timestamp * 1000).toLocaleTimeString()}`
              : processingStatus === 'completed'
                ? ' · Tracking completed'
                : ''}
          </div>
        </CardContent>
      </Card>

      <AiInsights derived={derived} enabled={derived.ready} live={isLive} />
    </div>
  )
}
