import type { LiveFrame } from './live-engine'

export interface OverlayOptions {
  showLabels: boolean
  showTrails: boolean
  teamColors: { team_a: string; team_b: string }
}

const TEAM_FALLBACK: Record<string, string> = {
  team_a: '#E11D48',
  team_b: '#2563EB',
  ball: '#FACC15',
  unknown: '#94A3B8',
}

/**
 * Maps source-video pixels onto the letterboxed rectangle an `object-contain`
 * <video> actually paints, so boxes line up with players at any aspect ratio.
 */
export function contentRect(
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number,
) {
  if (!videoWidth || !videoHeight) {
    return { scale: 1, offsetX: 0, offsetY: 0, width: containerWidth, height: containerHeight }
  }
  const scale = Math.min(containerWidth / videoWidth, containerHeight / videoHeight)
  const width = videoWidth * scale
  const height = videoHeight * scale
  return {
    scale,
    offsetX: (containerWidth - width) / 2,
    offsetY: (containerHeight - height) / 2,
    width,
    height,
  }
}

const trails = new Map<number, Array<{ x: number; y: number }>>()

export function clearTrails() {
  trails.clear()
}

/**
 * Appends one trail point per object.
 *
 * Kept separate from drawing because the overlay repaints every animation
 * frame while detections arrive only a few times a second; accumulating inside
 * the draw call would sample the same position dozens of times.
 */
export function recordTrails(frame: LiveFrame) {
  const live = new Set<number>()
  for (const object of frame.tracking_data) {
    if (object.class === 'ball') continue
    live.add(object.track_id)
    const history = trails.get(object.track_id) || []
    history.push({ x: object.bbox[0] + object.bbox[2] / 2, y: object.bbox[1] + object.bbox[3] })
    if (history.length > 18) history.shift()
    trails.set(object.track_id, history)
  }
  Array.from(trails.keys()).forEach((id) => {
    if (!live.has(id)) trails.delete(id)
  })
}

/**
 * @param extrapolateMs Time elapsed since this frame was detected. Detection
 *   runs at a few hertz, so boxes are advanced along each track's motion vector
 *   to keep the overlay glued to the players between detections instead of
 *   visibly stepping.
 */
export function drawOverlay(
  canvas: HTMLCanvasElement,
  frame: LiveFrame,
  options: OverlayOptions,
  extrapolateMs = 0,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const cssWidth = canvas.clientWidth
  const cssHeight = canvas.clientHeight
  if (!cssWidth || !cssHeight) return

  const pixelWidth = Math.round(cssWidth * dpr)
  const pixelHeight = Math.round(cssHeight * dpr)
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssWidth, cssHeight)

  const [videoWidth, videoHeight] = frame.resolution
  const rect = contentRect(cssWidth, cssHeight, videoWidth, videoHeight)
  const toX = (x: number) => rect.offsetX + x * rect.scale
  const toY = (y: number) => rect.offsetY + y * rect.scale

  // Cap the lead so a lost or mis-tracked object drifts a little rather than
  // flying off across the pitch while detection catches up.
  const lead = Math.max(
    0,
    Math.min(extrapolateMs / Math.max(frame.detection_interval_ms || 120, 1), 1.25),
  )

  for (const object of frame.tracking_data) {
    const color =
      object.color ||
      (object.team === 'team_a'
        ? options.teamColors.team_a
        : object.team === 'team_b'
          ? options.teamColors.team_b
          : TEAM_FALLBACK[object.team] || TEAM_FALLBACK.unknown)

    const driftX = object.coasted ? 0 : (object.velocity?.[0] || 0) * lead
    const driftY = object.coasted ? 0 : (object.velocity?.[1] || 0) * lead
    const x = toX(object.bbox[0] + driftX)
    const y = toY(object.bbox[1] + driftY)
    const w = object.bbox[2] * rect.scale
    const h = object.bbox[3] * rect.scale

    if (object.class === 'ball') {
      drawBall(ctx, x + w / 2, y + h / 2, Math.max(w, h) / 2)
      continue
    }

    if (options.showTrails) {
      const history = trails.get(object.track_id)
      if (history) drawTrail(ctx, history, toX, toY, color)
    }

    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = object.coasted ? 1.2 : 2
    if (object.coasted) ctx.setLineDash([4, 4])
    ctx.globalAlpha = object.coasted ? 0.55 : 1
    roundedRect(ctx, x, y, w, h, 4)
    ctx.stroke()

    // A soft base ellipse reads as "standing on the pitch" and separates
    // overlapping players better than the box alone.
    ctx.globalAlpha = object.coasted ? 0.18 : 0.35
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.ellipse(x + w / 2, y + h, Math.max(w * 0.42, 4), Math.max(w * 0.16, 2), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    if (options.showLabels && !object.coasted) {
      drawLabel(ctx, `${object.label ?? object.track_id}`, x, y, color)
    }
  }

}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
) {
  ctx.save()
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
  const padding = 4
  const width = ctx.measureText(text).width + padding * 2
  const height = 15
  ctx.fillStyle = color
  roundedRect(ctx, x, Math.max(0, y - height - 2), width, height, 3)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.fillText(text, x + padding, Math.max(0, y - height - 2) + 11)
  ctx.restore()
}

function drawBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  const r = Math.max(radius, 4)
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r * 2.4, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(250, 204, 21, 0.18)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#FDE68A'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#F59E0B'
  ctx.stroke()
  ctx.restore()
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  history: Array<{ x: number; y: number }>,
  toX: (x: number) => number,
  toY: (y: number) => number,
  color: string,
) {
  if (history.length < 2) return
  ctx.save()
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  for (let i = 1; i < history.length; i++) {
    ctx.globalAlpha = (i / history.length) * 0.35
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.moveTo(toX(history[i - 1].x), toY(history[i - 1].y))
    ctx.lineTo(toX(history[i].x), toY(history[i].y))
    ctx.stroke()
  }
  ctx.restore()
}
