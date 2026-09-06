import type { Box, TrackedObject, VisionTeam } from './types'

/**
 * Assigns players to two teams from jersey colour.
 *
 * Per track we collect torso pixels, reduce them to a robust median colour, and
 * cluster those colours into two groups in CIELAB (perceptual distance, so
 * shading and shirt sponsors matter less than hue). Cluster identity is carried
 * across runs by matching centroids, which keeps team A from swapping to team B
 * halfway through a clip.
 */

interface Lab {
  l: number
  a: number
  b: number
}

interface TrackColor {
  samples: Array<[number, number, number]>
  color: string
  lab: Lab
  team: VisionTeam
  /** Confidence 0..1 from cluster separation; low values stay 'unknown'. */
  confidence: number
}

const MAX_SAMPLES = 24
const RECLUSTER_EVERY = 8
const MIN_PLAYERS_TO_CLUSTER = 4
/** Weighted-Lab gap two kits must show before players are split into teams. */
const MIN_TEAM_SEPARATION = 18
/** Smallest share the minority cluster may hold before the split is retried. */
const MIN_SPLIT_BALANCE = 0.25

export class TeamClassifier {
  private tracks = new Map<number, TrackColor>()
  private centroids: [Lab, Lab] | null = null
  /** Most saturated observed shirt per cluster — a truer kit colour than the mean. */
  private representatives: [Lab | null, Lab | null] = [null, null]
  private frames = 0

  reset() {
    this.tracks.clear()
    this.centroids = null
    this.representatives = [null, null]
    this.frames = 0
  }

  get teamColors() {
    if (!this.centroids) return null
    return {
      team_a: labToHex(vivid(this.representatives[0] || this.centroids[0])),
      team_b: labToHex(vivid(this.representatives[1] || this.centroids[1])),
    }
  }

  /**
   * @param image  Downscaled frame pixels.
   * @param scale  Source-pixels per image-pixel, so source boxes can be mapped in.
   */
  update(image: ImageData, scale: number, objects: TrackedObject[]) {
    this.frames++

    const people = objects.filter((object) => object.class === 'person' && !object.coasted)
    for (const person of people) {
      const sample = sampleJersey(image, person.bbox, scale)
      if (!sample) continue
      const entry = this.tracks.get(person.id) || {
        samples: [],
        color: '',
        lab: { l: 0, a: 0, b: 0 },
        team: 'unknown' as VisionTeam,
        confidence: 0,
      }
      entry.samples.push(sample)
      if (entry.samples.length > MAX_SAMPLES) entry.samples.shift()
      this.tracks.set(person.id, entry)
    }

    // Drop bookkeeping for tracks the tracker has retired.
    const live = new Set(objects.map((object) => object.id))
    Array.from(this.tracks.keys()).forEach((id) => {
      if (!live.has(id)) this.tracks.delete(id)
    })

    if (this.frames % RECLUSTER_EVERY === 1 || !this.centroids) {
      this.recluster()
    }

    return objects.map((object) => {
      if (object.class === 'ball') return { ...object, team: 'ball' as VisionTeam, color: '#F8FAFC' }
      const entry = this.tracks.get(object.id)
      if (!entry || !entry.color) return object
      // Report the team's identifying colour rather than this player's own
      // washed-out sample, so the legend and overlay stay legible and consistent.
      const colors = this.teamColors
      const teamColor = colors
        ? entry.team === 'team_a' ? colors.team_a : colors.team_b
        : entry.color
      return { ...object, team: entry.team, color: entry.team === 'unknown' ? entry.color : teamColor }
    })
  }

  private recluster() {
    const entries: Array<{ id: number; entry: TrackColor; lab: Lab }> = []
    this.tracks.forEach((entry, id) => {
      if (entry.samples.length < 2) return
      const rgb = medianRgb(entry.samples)
      entry.color = rgbToHex(rgb)
      entry.lab = rgbToLab(rgb)
      entries.push({ id, entry, lab: entry.lab })
    })

    if (entries.length < MIN_PLAYERS_TO_CLUSTER) return

    const labs = entries.map((item) => item.lab)
    let centroids = kMeans2(labs, this.centroids)
    if (!centroids) return

    // Two teams on a pitch are roughly balanced. A lopsided split usually means
    // k-means settled on a lighting boundary (sunlit vs shaded) rather than on
    // the kits, and seeding from the previous centroids can keep it stuck
    // there. Re-seeding from the two most distant colours breaks that out.
    if (splitRatio(labs, centroids) < MIN_SPLIT_BALANCE) {
      const reseeded = kMeans2(labs, null)
      if (reseeded && splitRatio(labs, reseeded) > splitRatio(labs, centroids)) {
        centroids = reseeded
      }
    }

    this.centroids = orderCentroids(centroids, this.centroids)

    const [ca, cb] = this.centroids
    const separation = labDistance(ca, cb)
    const chromaOf = (lab: Lab) => Math.hypot(lab.a, lab.b)
    const bestByChroma: [Lab | null, Lab | null] = [null, null]

    for (const item of entries) {
      const da = labDistance(item.lab, ca)
      const db = labDistance(item.lab, cb)
      const nearest = da <= db ? 'team_a' : 'team_b'
      const margin = Math.abs(da - db)
      // A shirt that sits between both centroids (referee, keeper, bad sample)
      // gets no team rather than a coin-flip guess.
      const confidence = separation > 0 ? Math.min(1, margin / separation) : 0
      item.entry.confidence = confidence
      // Two clusters always exist, even when only one team is on screen, so a
      // weak split has to mean "unknown" rather than an arbitrary halving.
      const decided = separation >= MIN_TEAM_SEPARATION && confidence >= 0.12
      item.entry.team = decided ? (nearest as VisionTeam) : 'unknown'

      if (decided) {
        const slot = nearest === 'team_a' ? 0 : 1
        const incumbent = bestByChroma[slot]
        if (!incumbent || chromaOf(item.lab) > chromaOf(incumbent)) {
          bestByChroma[slot] = item.lab
        }
      }
    }

    if (bestByChroma[0]) this.representatives[0] = bestByChroma[0]
    if (bestByChroma[1]) this.representatives[1] = bestByChroma[1]
  }
}

/**
 * Median colour of the torso: the upper-middle of the bounding box, which
 * avoids the head, shorts, and the grass showing around the legs.
 */
function sampleJersey(image: ImageData, box: Box, scale: number): [number, number, number] | null {
  const x = box[0] / scale
  const y = box[1] / scale
  const w = box[2] / scale
  const h = box[3] / scale
  if (w < 3 || h < 6) return null

  const x0 = Math.max(0, Math.round(x + w * 0.28))
  const x1 = Math.min(image.width, Math.round(x + w * 0.72))
  const y0 = Math.max(0, Math.round(y + h * 0.16))
  const y1 = Math.min(image.height, Math.round(y + h * 0.48))
  if (x1 - x0 < 1 || y1 - y0 < 1) return null

  const reds: number[] = []
  const greens: number[] = []
  const blues: number[] = []
  const step = Math.max(1, Math.floor((x1 - x0) / 8))

  for (let yy = y0; yy < y1; yy += step) {
    for (let xx = x0; xx < x1; xx += step) {
      const i = (yy * image.width + xx) * 4
      const r = image.data[i]
      const g = image.data[i + 1]
      const b = image.data[i + 2]
      // Skip pitch showing through and deep shadow, both of which pull the
      // median towards a colour the player is not wearing.
      if (g > 55 && g > r + 14 && g > b + 14) continue
      if (r + g + b < 60) continue
      reds.push(r)
      greens.push(g)
      blues.push(b)
    }
  }

  if (reds.length < 3) return null
  return [median(reds), median(greens), median(blues)]
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function medianRgb(samples: Array<[number, number, number]>): [number, number, number] {
  return [
    median(samples.map((s) => s[0])),
    median(samples.map((s) => s[1])),
    median(samples.map((s) => s[2])),
  ]
}

function kMeans2(points: Lab[], seed: [Lab, Lab] | null): [Lab, Lab] | null {
  if (points.length < 2) return null

  let a: Lab
  let b: Lab
  if (seed) {
    a = seed[0]
    b = seed[1]
  } else {
    // Seed with the two most distant colours so the split starts at the real gap.
    let best = -1
    a = points[0]
    b = points[1]
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = labDistance(points[i], points[j])
        if (d > best) {
          best = d
          a = points[i]
          b = points[j]
        }
      }
    }
  }

  for (let iteration = 0; iteration < 12; iteration++) {
    const groupA: Lab[] = []
    const groupB: Lab[] = []
    for (const point of points) {
      if (labDistance(point, a) <= labDistance(point, b)) groupA.push(point)
      else groupB.push(point)
    }
    if (!groupA.length || !groupB.length) break
    const nextA = meanLab(groupA)
    const nextB = meanLab(groupB)
    const moved = labDistance(nextA, a) + labDistance(nextB, b)
    a = nextA
    b = nextB
    if (moved < 0.5) break
  }

  return [a, b]
}

/** Keeps team A pinned to whichever new centroid is closest to the old team A. */
function orderCentroids(next: [Lab, Lab], previous: [Lab, Lab] | null): [Lab, Lab] {
  if (!previous) return next
  const straight = labDistance(next[0], previous[0]) + labDistance(next[1], previous[1])
  const swapped = labDistance(next[1], previous[0]) + labDistance(next[0], previous[1])
  return swapped < straight ? [next[1], next[0]] : next
}

/** Share of points falling in the smaller of the two clusters, 0..0.5. */
function splitRatio(points: Lab[], centroids: [Lab, Lab]) {
  if (!points.length) return 0
  let a = 0
  for (const point of points) {
    if (labDistance(point, centroids[0]) <= labDistance(point, centroids[1])) a++
  }
  return Math.min(a, points.length - a) / points.length
}

function meanLab(points: Lab[]): Lab {
  const n = points.length
  return {
    l: points.reduce((sum, p) => sum + p.l, 0) / n,
    a: points.reduce((sum, p) => sum + p.a, 0) / n,
    b: points.reduce((sum, p) => sum + p.b, 0) / n,
  }
}

/**
 * Lightness is down-weighted because it mostly encodes sun and shadow across
 * the pitch, while the a/b chroma axes carry the actual kit colour. Comparing
 * on raw Lab splits players into "in the light" and "in the shade" instead of
 * into two teams.
 */
const LIGHTNESS_WEIGHT = 0.35

function labDistance(x: Lab, y: Lab) {
  return Math.hypot((x.l - y.l) * LIGHTNESS_WEIGHT, x.a - y.a, x.b - y.b)
}

function pivotRgb(value: number) {
  const v = value / 255
  return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92
}

function pivotXyz(value: number) {
  return value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116
}

export function rgbToLab(rgb: [number, number, number]): Lab {
  const r = pivotRgb(rgb[0])
  const g = pivotRgb(rgb[1])
  const b = pivotRgb(rgb[2])
  const x = pivotXyz((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047)
  const y = pivotXyz(r * 0.2126 + g * 0.7152 + b * 0.0722)
  const z = pivotXyz((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) }
}

/**
 * Pulls a cluster centroid back towards a legible kit colour.
 *
 * Averaging torso pixels over many players mixes in shorts, skin and pitch, so
 * the mean of a red kit lands on muddy brown. Rescaling chroma along the same
 * hue angle — and lifting very dark or very washed-out results into a visible
 * range — recovers the colour a viewer would name, without inventing a hue.
 */
const MIN_CHROMA = 30

function vivid(lab: Lab): Lab {
  const chroma = Math.hypot(lab.a, lab.b)
  const lightness = Math.min(78, Math.max(28, lab.l))
  // Near-neutral kits (white, black, grey) have no hue to amplify; leave them.
  if (chroma < 4) return { l: lightness, a: lab.a, b: lab.b }
  const gain = Math.min(3, Math.max(1, MIN_CHROMA / chroma))
  return { l: lightness, a: lab.a * gain, b: lab.b * gain }
}

function labToRgb(lab: Lab): [number, number, number] {
  const y = (lab.l + 16) / 116
  const x = lab.a / 500 + y
  const z = y - lab.b / 200
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787)
  const X = inv(x) * 0.95047
  const Y = inv(y)
  const Z = inv(z) * 1.08883
  const toSrgb = (v: number) => {
    const c = v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v
    return Math.max(0, Math.min(255, Math.round(c * 255)))
  }
  return [
    toSrgb(X * 3.2406 + Y * -1.5372 + Z * -0.4986),
    toSrgb(X * -0.9689 + Y * 1.8758 + Z * 0.0415),
    toSrgb(X * 0.0557 + Y * -0.204 + Z * 1.057),
  ]
}

export function rgbToHex(rgb: [number, number, number]) {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
}

function labToHex(lab: Lab) {
  return rgbToHex(labToRgb(lab))
}
