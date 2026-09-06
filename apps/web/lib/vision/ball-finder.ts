import type { Box, Detection } from './types'
import { isPointOnPitch, type PitchMask } from './pitch'

/**
 * Heuristic soccer-ball finder used when the neural detector misses the ball.
 *
 * A soccer ball on grass is a small, bright, low-saturation blob surrounded by
 * pitch green. Requiring all four of those properties at once is what keeps
 * white boots, jersey patches and pitch lines out of the results.
 */

interface BallFinderOptions {
  /** Person boxes in ImageData pixel space; their upper bodies are masked out. */
  personBoxes?: Box[]
  /** Restricts the search to the field of play, which allows looser thresholds. */
  pitch?: PitchMask
  minArea?: number
  maxArea?: number
  /** Fraction of the surrounding ring that must be pitch green. */
  minGreenRing?: number
}

function isBright(r: number, g: number, b: number) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max > 150 && max - min < 70
}

function isGreen(r: number, g: number, b: number) {
  return g > 55 && g > r + 12 && g > b + 12
}

/** Scales the area thresholds so they mean the same thing at any canvas width. */
function scaleArea(value: number, width: number) {
  const factor = (width / 512) ** 2
  return value * factor
}

export function findBallCandidates(
  image: ImageData,
  options: BallFinderOptions = {},
): Detection[] {
  const { width, height, data } = image
  const pitch = options.pitch
  const minArea = options.minArea ?? scaleArea(3, width)
  const maxArea = options.maxArea ?? scaleArea(200, width)
  // Confining the search to the playing surface already removes the crowd,
  // boards and floodlights, so the ring test can be far less strict — it was
  // rejecting real balls near players and lines.
  const minGreenRing = options.minGreenRing ?? (pitch?.reliable ? 0.3 : 0.5)

  const mask = new Uint8Array(width * height)
  const green = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    if (isGreen(r, g, b)) green[p] = 1
    else if (isBright(r, g, b)) mask[p] = 1
  }

  if (pitch?.reliable) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (y < pitch.horizon[x]) mask[y * width + x] = 0
      }
    }
  }

  // Mask out player torsos: white/light jerseys are the main false-positive source.
  for (const box of options.personBoxes || []) {
    const x0 = Math.max(0, Math.floor(box[0]))
    const y0 = Math.max(0, Math.floor(box[1]))
    const x1 = Math.min(width, Math.ceil(box[0] + box[2]))
    // Keep the lowest ~25% of the body visible so a ball at the feet still registers.
    const y1 = Math.min(height, Math.ceil(box[1] + box[3] * 0.75))
    for (let y = y0; y < y1; y++) {
      mask.fill(0, y * width + x0, y * width + x1)
    }
  }

  const visited = new Uint8Array(width * height)
  const stack: number[] = []
  const candidates: Detection[] = []

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue
    visited[start] = 1
    stack.length = 0
    stack.push(start)

    let area = 0
    let minX = width
    let maxX = 0
    let minY = height
    let maxY = 0

    while (stack.length) {
      const p = stack.pop() as number
      const x = p % width
      const y = (p - x) / width
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (area > maxArea) break

      if (x > 0 && mask[p - 1] && !visited[p - 1]) { visited[p - 1] = 1; stack.push(p - 1) }
      if (x < width - 1 && mask[p + 1] && !visited[p + 1]) { visited[p + 1] = 1; stack.push(p + 1) }
      if (y > 0 && mask[p - width] && !visited[p - width]) { visited[p - width] = 1; stack.push(p - width) }
      if (y < height - 1 && mask[p + width] && !visited[p + width]) { visited[p + width] = 1; stack.push(p + width) }
    }

    if (area < minArea || area > maxArea) continue

    const w = maxX - minX + 1
    const h = maxY - minY + 1
    const aspect = w / h
    if (aspect < 0.55 || aspect > 1.8) continue
    // A ball fills most of its bounding box; pitch lines and shirt edges do not.
    if (area / (w * h) < 0.45) continue

    const ring = greenRingFraction(green, width, height, minX, minY, w, h)
    if (ring < minGreenRing) continue

    if (pitch && !isPointOnPitch(minX + w / 2, minY + h / 2, pitch)) continue

    candidates.push({
      bbox: [minX, minY, w, h],
      // Confidence rises with how cleanly the blob is ringed by pitch.
      score: Math.min(0.55, 0.2 + ring * 0.4),
      class: 'ball',
    })
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 3)
}

function greenRingFraction(
  green: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const pad = Math.max(3, Math.round(Math.max(w, h) * 0.9))
  const x0 = Math.max(0, x - pad)
  const y0 = Math.max(0, y - pad)
  const x1 = Math.min(width - 1, x + w + pad)
  const y1 = Math.min(height - 1, y + h + pad)
  let total = 0
  let hits = 0
  for (let yy = y0; yy <= y1; yy++) {
    const inRowBand = yy < y || yy >= y + h
    for (let xx = x0; xx <= x1; xx++) {
      if (!inRowBand && xx >= x && xx < x + w) continue
      total++
      if (green[yy * width + xx]) hits++
    }
  }
  return total > 0 ? hits / total : 0
}
