'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import type { DerivedAnalytics } from '@/lib/analytics'

/** Minimum wall-clock gap between automatic refreshes while analysis streams. */
const AUTO_REFRESH_MS = 30_000

/**
 * Whether there is enough tracked play to be worth a briefing.
 *
 * Analytics become "ready" the moment a single track exists, which is well
 * before any possession or passing has accumulated. Asking for a briefing then
 * spends a request to be told everything is zero, and the rate limiter leaves
 * that empty summary on screen for the next half minute.
 */
function hasSomethingToSay(derived: DerivedAnalytics) {
  if (derived.playerCount < 4) return false
  // The briefing leads with possession, so wait until that line is worth
  // reading rather than firing on the first fraction of a second of control.
  return derived.possession.total_possession_time >= 3
}

/**
 * Formation names degrade to "2 players" when too few of a side are on screen.
 * That is fine in a stat tile but reads as nonsense in prose, so it is sent as
 * an explicit unknown instead of a fake shape.
 */
function formationOrUnknown(name: string) {
  return /^\d+-\d+-\d+$/.test(name) ? name : 'not yet established'
}

function compactSummary(derived: DerivedAnalytics) {
  return {
    players: derived.playerCount,
    ballDetected: derived.ballDetected,
    possessionSource: derived.possession.source,
    teamA: derived.teamLabels.team_a,
    teamB: derived.teamLabels.team_b,
    possessionPctA: Number(derived.possession.team_a_percentage.toFixed(1)),
    possessionPctB: Number(derived.possession.team_b_percentage.toFixed(1)),
    // Named explicitly: a bare "possessionSeconds" was read back as an average
    // per-spell duration, and a bare "winA" as duels won.
    totalTrackedControlSeconds: Number(derived.possession.total_possession_time.toFixed(1)),
    // total_passes is attempts. Sending it as "completed" told the model every
    // pass found its man.
    passesAttempted: derived.passes.total_passes,
    passesCompleted: derived.passes.successful_passes,
    passSuccessRatePct: Number(derived.passes.pass_success_rate.toFixed(1)),
    passesAttemptedByTeamA: derived.passes.team_a_passes,
    passesAttemptedByTeamB: derived.passes.team_b_passes,
    formationA: formationOrUnknown(derived.team.teamA.name),
    formationB: formationOrUnknown(derived.team.teamB.name),
    sprints: derived.extras.sprints,
    attackingThirdA: Number(derived.extras.attackingThirdA.toFixed(1)),
    attackingThirdB: Number(derived.extras.attackingThirdB.toFixed(1)),
    modelWinProbabilityPctA: Number(derived.extras.winA.toFixed(1)),
    modelWinProbabilityPctB: Number(derived.extras.winB.toFixed(1)),
    turnovers: derived.events.filter((event) => event.type === 'turnover').length,
    topDistance: derived.players.slice(0, 5).map((player) => ({
      id: player.id,
      team: player.team,
      meters: Number(player.distanceM.toFixed(1)),
      sprints: player.sprints,
    })),
  }
}

/**
 * Coarse fingerprint of the match state.
 *
 * Live numbers move every few hundred milliseconds; refreshing the briefing on
 * every twitch would be both unreadable and a needless spend, so a refresh is
 * only worth making once the picture has actually shifted.
 */
function coarseKey(summary: ReturnType<typeof compactSummary>) {
  return [
    Math.round(summary.possessionPctA / 5),
    Math.round(summary.passesAttempted / 5),
    Math.round(summary.sprints / 3),
    Math.round(summary.players / 4),
    summary.ballDetected,
    summary.formationA,
    summary.formationB,
  ].join('|')
}

export function AiInsights({
  derived,
  enabled,
  live = false,
}: {
  derived: DerivedAnalytics
  enabled: boolean
  live?: boolean
}) {
  const [text, setText] = useState('')
  const [model, setModel] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [generatedAt, setGeneratedAt] = useState<number | null>(null)

  const summary = useMemo(() => compactSummary(derived), [derived])
  const key = useMemo(() => coarseKey(summary), [summary])

  const summaryRef = useRef(summary)
  summaryRef.current = summary
  const lastRequestRef = useRef(0)
  const lastKeyRef = useRef('')
  const abortRef = useRef<AbortController | null>(null)

  const generate = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    lastRequestRef.current = Date.now()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: summaryRef.current }),
        signal: controller.signal,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Insights request failed')
      setText(body.insights || '')
      setModel(body.model || '')
      setGeneratedAt(Date.now())
      setError(body.warning || '')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Insights unavailable')
    } finally {
      setLoading(false)
    }
  }, [])

  const substantive = hasSomethingToSay(derived)

  useEffect(() => {
    if (!enabled || !derived.ready || !substantive) return
    if (key === lastKeyRef.current) return

    const sinceLast = Date.now() - lastRequestRef.current
    const isFirstRun = lastRequestRef.current === 0
    // The first briefing appears as soon as there is something to say; after
    // that, automatic refreshes are rate limited.
    if (!isFirstRun && live && sinceLast < AUTO_REFRESH_MS) return
    if (!isFirstRun && !live && sinceLast < 5_000) return

    lastKeyRef.current = key
    void generate()
  }, [enabled, derived.ready, substantive, key, live, generate])

  useEffect(() => () => abortRef.current?.abort(), [])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          GPT Match Insights
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-xs"
            onClick={() => generate()}
            disabled={!enabled || loading}
          >
            <RefreshCw className={`mr-1 h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!enabled && (
          <p className="text-sm text-gray-500">
            Play the video — a coaching briefing is generated from the live stats.
          </p>
        )}
        {enabled && !substantive && !text && (
          <p className="text-sm text-gray-500">
            Waiting for enough tracked play — the briefing is written once possession and
            passing have something in them.
          </p>
        )}
        {enabled && loading && !text && (
          <p className="text-sm text-gray-500">Analyzing possession, shape, and workload…</p>
        )}
        {enabled && error && <p className="text-sm text-amber-700">{error}</p>}
        {text && <div className="whitespace-pre-wrap text-sm leading-6 text-gray-800">{text}</div>}
        {(model || generatedAt) && (
          <p className="text-[11px] text-gray-400">
            {model ? `Model: ${model}` : ''}
            {model && generatedAt ? ' · ' : ''}
            {generatedAt ? `Updated ${new Date(generatedAt).toLocaleTimeString()}` : ''}
            {live ? ' · auto-refreshes as play develops' : ''}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
