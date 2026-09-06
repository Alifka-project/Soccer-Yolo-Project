import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * The configured model first, then progressively faster fallbacks.
 *
 * Full gpt-5 is deliberately not in the default chain: on this task it spends
 * ~17s reasoning even at low effort, which is too slow for a panel that
 * refreshes while a clip plays. Set OPENAI_MODEL to use it anyway.
 */
const MODELS = [
  process.env.OPENAI_MODEL,
  'gpt-5-mini',
  'gpt-4.1',
  'gpt-4o-mini',
].filter((model, index, list): model is string => Boolean(model) && list.indexOf(model) === index)

/** A briefing that arrives after the play it describes is worthless. */
const REQUEST_TIMEOUT_MS = 25_000

/**
 * Override to route through an OpenAI-compatible gateway, Azure deployment or a
 * local stub. Defaults to the public API.
 */
const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '')

const SYSTEM_PROMPT =
  'You are a professional football analyst. Write a concise coaching briefing from computer-vision match stats. '
  + 'Use the jersey colour names in the team labels. Never invent events that are not in the numbers — no shots, goals or named players. '
  + 'If a formation is given as "not yet established", say the shape is still unclear rather than inventing one. '
  + 'If possessionSource is "proximity", note that possession is estimated from play location rather than a tracked ball. '
  + 'Field meanings, do not reinterpret them: totalTrackedControlSeconds is the total time the ball was under tracked control, not an average spell length; '
  + 'modelWinProbabilityPct* is this system\'s win-probability estimate, not duels or 50/50s won; attackingThird* is the share of that team\'s players in the attacking third. '
  + 'Keep it under 180 words with short sections: Shape, Possession, Workload.'

/**
 * Deterministic briefing used whenever OpenAI is unavailable.
 *
 * This is the panel's floor, not an error state: the dashboard is a live
 * demo surface, so a missing or rate-limited key must still leave a readable
 * summary on screen.
 */
function localBriefing(summary: any) {
  const teamA = summary.teamA || 'Team A'
  const teamB = summary.teamB || 'Team B'
  const possA = Number(summary.possessionPctA ?? 0)
  const possB = Number(summary.possessionPctB ?? 0)
  const leader = possA === possB ? null : possA > possB ? teamA : teamB
  const margin = Math.abs(possA - possB).toFixed(1)

  const provenance =
    summary.possessionSource === 'ball'
      ? 'Possession is measured from the tracked ball.'
      : summary.possessionSource === 'proximity'
        ? 'The ball was not detected, so possession is estimated from where play is concentrated — treat it as indicative.'
        : 'Possession is reported by the tracking worker.'

  const shape = `Shape: ${teamA} lines up ${summary.formationA || 'not yet established'}; ${teamB} lines up ${summary.formationB || 'not yet established'}. Attacking-third occupancy is ${summary.attackingThirdA ?? 0}% versus ${summary.attackingThirdB ?? 0}%, and ${summary.players ?? 0} players are being tracked.`

  const possession = leader
    ? `Possession: ${leader} is on top with ${Math.max(possA, possB)}% against ${Math.min(possA, possB)}%, a ${margin}-point edge across ${summary.totalTrackedControlSeconds ?? 0}s of tracked control. ${summary.passesCompleted ?? 0} passes completed (${teamA} ${summary.passesCompletedByTeamA ?? 0}, ${teamB} ${summary.passesCompletedByTeamB ?? 0}) with ${summary.turnovers ?? 0} turnovers. ${provenance}`
    : `Possession: the two sides are level so far across ${summary.totalTrackedControlSeconds ?? 0}s of tracked control, with ${summary.passesCompleted ?? 0} passes and ${summary.turnovers ?? 0} turnovers. ${provenance}`

  const runners = (summary.topDistance || [])
    .slice(0, 3)
    .map((player: any) => `P${player.id} ${player.meters}m`)
    .join(', ')
  const workload = `Workload: ${summary.sprints ?? 0} sprint bursts recorded${runners ? `; highest distance covered by ${runners}` : ''}. Win probability currently reads ${summary.modelWinProbabilityPctA ?? 50}% / ${summary.modelWinProbabilityPctB ?? 50}%.`

  return [shape, possession, workload].join('\n\n')
}

function extractResponseText(body: any) {
  if (typeof body?.output_text === 'string' && body.output_text.trim()) return body.output_text.trim()
  const message = body?.output?.find((item: any) => item.type === 'message')
  const text = message?.content?.find((part: any) => part.type === 'output_text')?.text
  if (typeof text === 'string' && text.trim()) return text.trim()
  const chat = body?.choices?.[0]?.message?.content
  if (typeof chat === 'string' && chat.trim()) return chat.trim()
  return ''
}

async function completeWithModel(apiKey: string, model: string, summary: unknown) {
  const reasoning = /^(gpt-5|o[134])/.test(model)
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(summary) },
  ]
  const chatPayload: Record<string, unknown> = { model, messages }
  if (reasoning) {
    // Reasoning models spend the completion budget on hidden reasoning tokens
    // before writing anything. At 500 the whole budget went to reasoning and
    // the response came back empty with finish_reason "length", so the model
    // silently appeared to fail. Give it room, and keep the effort low: this
    // is short-form summarisation of numbers already computed.
    chatPayload.max_completion_tokens = 2000
    chatPayload.reasoning_effort = 'low'
  } else {
    chatPayload.max_tokens = 500
    chatPayload.temperature = 0.4
  }

  const chatRes = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(chatPayload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const chatBody = await chatRes.json().catch(() => ({}))
  if (chatRes.ok) {
    const text = extractResponseText(chatBody)
    if (text) return { text, model: chatBody.model || model }
  }

  const responsePayload: Record<string, unknown> = {
    model,
    input: messages,
    max_output_tokens: reasoning ? 2000 : 500,
  }
  if (reasoning) responsePayload.reasoning = { effort: 'low' }
  else responsePayload.temperature = 0.4

  const responseRes = await fetch(`${OPENAI_BASE}/v1/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(responsePayload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const responseBody = await responseRes.json().catch(() => ({}))
  if (responseRes.ok) {
    const text = extractResponseText(responseBody)
    if (text) return { text, model: responseBody.model || model }
  }

  throw new Error(
    responseBody.error?.message || chatBody.error?.message || `OpenAI error (${chatRes.status})`,
  )
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.summary) {
    return NextResponse.json({ error: 'Missing analytics summary.' }, { status: 400 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      insights: localBriefing(body.summary),
      model: 'built-in analyst',
      warning: 'OPENAI_API_KEY is not set — showing the built-in briefing.',
    })
  }

  let lastError = 'No GPT model succeeded'
  let billingBlocked = false
  let keyRejected = false
  for (const model of MODELS) {
    try {
      const result = await completeWithModel(apiKey, model, body.summary)
      return NextResponse.json({ insights: result.text, model: result.model })
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Insights failed'
      if (/invalid api key|incorrect api key|401/i.test(lastError)) {
        keyRejected = true
        break
      }
      if (/credits remaining|billing|quota|insufficient/i.test(lastError)) {
        billingBlocked = true
        break
      }
    }
  }

  // Every failure mode still returns a usable briefing; only the warning
  // changes, so the dashboard never shows an empty insights card.
  const warning = keyRejected
    ? 'OpenAI rejected the API key — showing the built-in briefing. Rotate the key in apps/web/.env.local.'
    : billingBlocked
      ? `OpenAI quota unavailable (${lastError}) — showing the built-in briefing.`
      : `OpenAI unreachable (${lastError}) — showing the built-in briefing.`

  return NextResponse.json({
    insights: localBriefing(body.summary),
    model: 'built-in analyst',
    warning,
  })
}
