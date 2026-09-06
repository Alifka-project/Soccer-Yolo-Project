import type { Box } from './types'

/**
 * Locates the playing surface in a frame.
 *
 * Broadcast footage is full of people who are not players: photographers,
 * camera operators, substitutes, staff and the crowd, all of them detected
 * happily by a person detector. Testing only for grass underfoot is not enough,
 * because the strip behind the advertising boards is grass too.
 *
 * What separates them is the pitch boundary. The playing surface is the large
 * connected green region at the bottom of frame, so anyone whose feet sit above
 * its upper edge is off the field of play.
 */

export interface PitchMask {
  width: number
  height: number
  /** 1 where the pixel belongs to the playing surface. */
  mask: Uint8Array
  /** Topmost pitch row per column; height means "no pitch in this column". */
  horizon: Int16Array
  /** Fraction of the frame that is playing surface. */
  coverage: number
  /** False when too little grass is visible to judge, e.g. a tight close-up. */
  reliable: boolean
}

function isGrass(r: number, g: number, b: number) {
  // Green-dominant and not too dark. Deliberately loose: shadowed turf, worn
  // patches and mown stripes all still need to count as pitch.
  return g > 40 && g >= r + 6 && g >= b + 6
}

export function computePitchMask(image: ImageData): PitchMask {
  const { width, height, data } = image
  const mask = new Uint8Array(width * height)
  let grassPixels = 0

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (isGrass(data[i], data[i + 1], data[i + 2])) {
      mask[p] = 1
      grassPixels++
    }
  }

  const coverage = grassPixels / (width * height)

  // Per column, walk up from the bottom while the neighbourhood stays mostly
  // grass. Requiring a run rather than a single pixel stops a player's shirt or
  // a pitch marking from cutting the column short.
  const window = Math.max(6, Math.round(height * 0.03))
  const horizon = new Int16Array(width)

  for (let x = 0; x < width; x++) {
    let top = height
    let y = height - 1
    while (y >= 0) {
      let grass = 0
      const limit = Math.max(0, y - window + 1)
      for (let yy = y; yy >= limit; yy--) {
        if (mask[yy * width + x]) grass++
      }
      const span = y - limit + 1
      if (grass / span < 0.5) break
      top = limit
      y -= Math.max(1, Math.floor(window / 2))
    }
    horizon[x] = top
  }

  // Smooth across columns: individual columns are cut short by players and
  // posts standing on the boundary.
  const smoothed = new Int16Array(width)
  const radius = Math.max(2, Math.round(width * 0.02))
  for (let x = 0; x < width; x++) {
    const from = Math.max(0, x - radius)
    const to = Math.min(width - 1, x + radius)
    const values: number[] = []
    for (let i = from; i <= to; i++) values.push(horizon[i])
    values.sort((a, b) => a - b)
    smoothed[x] = values[Math.floor(values.length / 2)]
  }

  return {
    width,
    height,
    mask,
    horizon: smoothed,
    coverage,
    // Below roughly a sixth of frame there is not enough pitch to trust the
    // boundary, so callers should not filter on it.
    reliable: coverage > 0.16,
  }
}

/**
 * Whether a detection is standing on the field of play.
 *
 * @param box   Detection box in the pitch mask's own pixel space.
 */
export function isPlayerOnPitch(box: Box, pitch: PitchMask) {
  if (!pitch.reliable) return true

  const footY = box[1] + box[3]
  const centreX = Math.round(box[0] + box[2] / 2)
  const x = Math.max(0, Math.min(pitch.width - 1, centreX))

  // Allow a little slack: the boundary is smoothed, and a far-side player's
  // feet sit almost exactly on it.
  const tolerance = Math.max(4, box[3] * 0.25)
  if (footY < pitch.horizon[x] - tolerance) return false

  // Grass immediately underfoot, which rejects people standing on the running
  // track or in a dugout that happens to fall below the boundary.
  return grassFractionBelow(box, pitch) >= 0.2
}

function grassFractionBelow(box: Box, pitch: PitchMask) {
  const footY = box[1] + box[3]
  const y0 = Math.max(0, Math.round(footY - box[3] * 0.05))
  const y1 = Math.min(pitch.height, Math.round(footY + Math.max(box[3] * 0.3, 5)))
  const x0 = Math.max(0, Math.round(box[0] - box[2] * 0.2))
  const x1 = Math.min(pitch.width, Math.round(box[0] + box[2] * 1.2))
  if (y1 - y0 < 1 || x1 - x0 < 1) return footY >= pitch.height - 4 ? 1 : 0

  let grass = 0
  let total = 0
  const stepX = Math.max(1, Math.floor((x1 - x0) / 10))
  const stepY = Math.max(1, Math.floor((y1 - y0) / 5))
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      total++
      if (pitch.mask[y * pitch.width + x]) grass++
    }
  }
  return total > 0 ? grass / total : 0
}

/** Whether a point lies on the playing surface. */
export function isPointOnPitch(x: number, y: number, pitch: PitchMask) {
  if (!pitch.reliable) return true
  const px = Math.max(0, Math.min(pitch.width - 1, Math.round(x)))
  const py = Math.max(0, Math.min(pitch.height - 1, Math.round(y)))
  return py >= pitch.horizon[px]
}
