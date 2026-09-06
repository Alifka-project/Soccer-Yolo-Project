'use client'

import { useMemo } from 'react'
import { useDerivedAnalytics } from '@/lib/use-derived-analytics'
import { useSessionStore } from '@/lib/store'
import type { MatchEvent } from '@/lib/analytics'

const EVENT_STYLE: Record<MatchEvent['type'], { label: string; shape: string }> = {
  pass: { label: 'Pass', shape: 'rounded-full' },
  turnover: { label: 'Turnover', shape: 'rotate-45' },
  sprint: { label: 'Sprint', shape: 'rounded-sm' },
  control: { label: 'Control', shape: 'rounded-full' },
}

function seek(time: number) {
  window.dispatchEvent(new CustomEvent('seekToTime', { detail: time }))
}

function formatClock(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function Timeline() {
  const { derived } = useDerivedAnalytics()
  const videoDuration = useSessionStore((state) => state.videoDuration)
  const currentFrame = useSessionStore((state) => state.currentFrame)
  const videoFps = useSessionStore((state) => state.videoFps)

  const events = derived.events
  const span = useMemo(() => {
    if (videoDuration > 0) return videoDuration
    const last = events[events.length - 1]
    return Math.max(last?.time || 0, 1)
  }, [videoDuration, events])

  const playhead = Math.min(100, Math.max(0, ((currentFrame / Math.max(videoFps, 1)) / span) * 100))
  const colorA = derived.teamColors.team_a
  const colorB = derived.teamColors.team_b

  return (
    <div className="h-20 border-t bg-muted/20 px-4 py-2">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">
          Event timeline · {events.length} event{events.length === 1 ? '' : 's'}
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: colorA }} /> Team A
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: colorB }} /> Team B
          </span>
          <span>{formatClock(currentFrame / Math.max(videoFps, 1))} / {formatClock(span)}</span>
        </span>
      </div>

      <div className="relative mt-2 h-8 rounded bg-muted/50">
        {events.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Play the video — passes, turnovers and sprints appear here as they are detected.
          </div>
        )}

        {events.map((event) => {
          const left = Math.min(99.5, Math.max(0, (event.time / span) * 100))
          const color = event.team === 'team_b' ? colorB : event.team === 'team_a' ? colorA : '#94A3B8'
          const style = EVENT_STYLE[event.type]
          return (
            <button
              key={event.id}
              type="button"
              onClick={() => seek(event.time)}
              title={`${formatClock(event.time)} · ${event.label} — ${event.detail}`}
              className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 border border-white/70 transition-transform hover:scale-150 ${style.shape}`}
              style={{ left: `${left}%`, background: color, opacity: event.type === 'sprint' ? 0.7 : 1 }}
              aria-label={`${style.label} at ${formatClock(event.time)}`}
            />
          )
        })}

        <div
          className="pointer-events-none absolute top-0 h-full w-px bg-foreground/70"
          style={{ left: `${playhead}%` }}
        />
      </div>
    </div>
  )
}
