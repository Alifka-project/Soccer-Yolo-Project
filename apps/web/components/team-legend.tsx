'use client'

import { rgbaFromHex } from '@/lib/analytics'

export function TeamLegend({
  colors,
  labels,
}: {
  colors: { team_a: string; team_b: string }
  labels: { team_a: string; team_b: string }
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {(['team_a', 'team_b'] as const).map((team) => (
        <div
          key={team}
          className="flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium"
          style={{
            borderColor: colors[team],
            background: rgbaFromHex(colors[team], 0.12),
            color: colors[team],
          }}
        >
          <span className="h-3 w-3 rounded-full shadow-sm" style={{ backgroundColor: colors[team] }} />
          {labels[team]}
        </div>
      ))}
    </div>
  )
}

export function TeamSwatchCard({
  color,
  label,
  value,
  sublabel,
}: {
  color: string
  label: string
  value: string
  sublabel?: string
}) {
  return (
    <div
      className="text-center p-3 rounded-lg border transition-colors"
      style={{ background: rgbaFromHex(color, 0.12), borderColor: rgbaFromHex(color, 0.35) }}
    >
      <div className="text-2xl font-bold tabular-nums mb-1" style={{ color }}>{value}</div>
      <div className="flex items-center justify-center gap-1.5 text-xs font-medium" style={{ color }}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </div>
      {sublabel ? <div className="text-xs text-gray-500 mt-1 tabular-nums">{sublabel}</div> : null}
    </div>
  )
}
