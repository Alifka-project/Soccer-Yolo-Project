import type { Box, Detection } from './types'
import { iou } from './types'
import { findBallCandidates } from './ball-finder'
import { computePitchMask, isPlayerOnPitch, isPointOnPitch } from './pitch'

export type DetectorQuality = 'fast' | 'balanced' | 'accurate'

export interface DetectorStatus {
  state: 'idle' | 'loading' | 'ready' | 'error'
  backend: string
  quality: DetectorQuality
  message: string
}

interface CocoModel {
  detect(
    img: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement,
    maxNumBoxes?: number,
    minScore?: number,
  ): Promise<Array<{ bbox: [number, number, number, number]; class: string; score: number }>>
}

/**
 * SSD-MobileNet resizes its input to 300x300, so a single pass over a wide
 * broadcast frame turns each player into a handful of pixels. Splitting the
 * frame into overlapping tiles and running the model per tile is what makes
 * far-side players detectable at all.
 */
const TILE_LAYOUT: Record<DetectorQuality, { cols: number; rows: number; base: 'lite_mobilenet_v2' | 'mobilenet_v2' }> = {
  fast: { cols: 1, rows: 1, base: 'lite_mobilenet_v2' },
  balanced: { cols: 2, rows: 1, base: 'lite_mobilenet_v2' },
  accurate: { cols: 2, rows: 1, base: 'mobilenet_v2' },
}

const PERSON_MIN_SCORE = 0.28
const BALL_MIN_SCORE = 0.12
const TILE_OVERLAP = 0.14

export class LiveDetector {
  private model: CocoModel | null = null
  private loading: Promise<void> | null = null
  private quality: DetectorQuality
  private backend = 'unknown'
  private work: HTMLCanvasElement | null = null
  private tile: HTMLCanvasElement | null = null
  private error = ''

  constructor(quality: DetectorQuality = 'balanced') {
    this.quality = quality
  }

  get status(): DetectorStatus {
    return {
      state: this.error ? 'error' : this.model ? 'ready' : this.loading ? 'loading' : 'idle',
      backend: this.backend,
      quality: this.quality,
      message: this.error,
    }
  }

  setQuality(quality: DetectorQuality) {
    // The tiling layout changes, but the loaded weights are reused when the
    // underlying base network is the same.
    const needsReload = TILE_LAYOUT[quality].base !== TILE_LAYOUT[this.quality].base
    this.quality = quality
    if (needsReload) {
      this.model = null
      this.loading = null
    }
  }

  async load() {
    if (this.model) return
    if (!this.loading) {
      this.loading = this.doLoad().catch((err) => {
        this.error = err instanceof Error ? err.message : 'Failed to load detector'
        this.loading = null
        throw err
      })
    }
    await this.loading
  }

  private async doLoad() {
    const tf = await import('@tensorflow/tfjs-core')
    await import('@tensorflow/tfjs-backend-webgl')
    try {
      await tf.setBackend('webgl')
    } catch {
      // Falls back to whatever backend registered successfully (usually CPU).
    }
    await tf.ready()
    this.backend = tf.getBackend()
    const cocoSsd = await import('@tensorflow-models/coco-ssd')
    this.model = (await cocoSsd.load({ base: TILE_LAYOUT[this.quality].base })) as unknown as CocoModel
    this.error = ''
  }

  /**
   * Runs detection on the current video frame.
   *
   * Returns detections in source-video pixel space plus the downscaled frame
   * pixels, which the caller reuses for jersey-colour clustering instead of
   * reading back from the GPU a second time.
   */
  async detect(video: HTMLVideoElement, targetWidth = 640) {
    await this.load()
    const model = this.model
    if (!model) return null

    const srcW = video.videoWidth
    const srcH = video.videoHeight
    if (!srcW || !srcH) return null

    const width = Math.min(targetWidth, srcW)
    const height = Math.round((width / srcW) * srcH)

    if (!this.work) this.work = document.createElement('canvas')
    const work = this.work
    if (work.width !== width || work.height !== height) {
      work.width = width
      work.height = height
    }
    const ctx = work.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, width, height)
    const image = ctx.getImageData(0, 0, width, height)

    const started = performance.now()
    const raw = await this.detectTiled(model, work, width, height)
    const inferenceMs = performance.now() - started

    // The pitch boundary is what separates players from photographers, camera
    // operators, substitutes and the crowd — all of whom the detector finds.
    const pitch = computePitchMask(image)
    const persons = raw.filter((d) => d.class === 'person' && isPlayerOnPitch(d.bbox, pitch))

    // A ball detected off the field of play is a stadium light, a helmet or a
    // ball in the stands, and would drag possession to whoever stood nearest.
    let balls = raw
      .filter((d) => d.class === 'ball')
      .filter((d) => isPointOnPitch(d.bbox[0] + d.bbox[2] / 2, d.bbox[1] + d.bbox[3] / 2, pitch))
    if (balls.length === 0) {
      balls = findBallCandidates(image, { personBoxes: persons.map((d) => d.bbox), pitch })
    }

    // Scale everything from the work canvas back to source-video pixels.
    const scale = srcW / width
    const toSource = (d: Detection): Detection => ({
      ...d,
      bbox: [d.bbox[0] * scale, d.bbox[1] * scale, d.bbox[2] * scale, d.bbox[3] * scale] as Box,
    })

    return {
      detections: [...persons, ...balls.slice(0, 1)].map(toSource),
      image,
      imageScale: scale,
      width: srcW,
      height: srcH,
      inferenceMs,
    }
  }

  /** Measured cost per tile is roughly constant: SSD resizes every tile to 300x300. */
  private async detectTiled(
    model: CocoModel,
    source: HTMLCanvasElement,
    width: number,
    height: number,
  ): Promise<Detection[]> {
    const { cols, rows } = TILE_LAYOUT[this.quality]
    if (cols === 1 && rows === 1) {
      return normalize(await model.detect(source, 40, Math.min(PERSON_MIN_SCORE, BALL_MIN_SCORE)))
    }

    if (!this.tile) this.tile = document.createElement('canvas')
    const tile = this.tile
    const tileW = Math.round(width / cols)
    const tileH = Math.round(height / rows)
    const padX = Math.round(tileW * TILE_OVERLAP)
    const padY = rows > 1 ? Math.round(tileH * TILE_OVERLAP) : 0
    const all: Detection[] = []

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sx = Math.max(0, col * tileW - padX)
        const sy = Math.max(0, row * tileH - padY)
        const sw = Math.min(width - sx, tileW + padX * 2)
        const sh = Math.min(height - sy, tileH + padY * 2)
        if (sw < 16 || sh < 16) continue
        if (tile.width !== sw || tile.height !== sh) {
          tile.width = sw
          tile.height = sh
        }
        const tctx = tile.getContext('2d')
        if (!tctx) continue
        tctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
        const found = normalize(await model.detect(tile, 30, Math.min(PERSON_MIN_SCORE, BALL_MIN_SCORE)))
        for (const det of found) {
          all.push({
            ...det,
            bbox: [det.bbox[0] + sx, det.bbox[1] + sy, det.bbox[2], det.bbox[3]],
          })
        }
      }
    }

    return nonMaxSuppression(all, 0.45)
  }
}

function normalize(
  raw: Array<{ bbox: [number, number, number, number]; class: string; score: number }>,
): Detection[] {
  const out: Detection[] = []
  for (const item of raw) {
    if (item.class === 'person') {
      if (item.score < PERSON_MIN_SCORE) continue
      out.push({ bbox: item.bbox, score: item.score, class: 'person' })
    } else if (item.class === 'sports ball') {
      if (item.score < BALL_MIN_SCORE) continue
      out.push({ bbox: item.bbox, score: item.score, class: 'ball' })
    }
  }
  return out
}

export function nonMaxSuppression(detections: Detection[], threshold: number): Detection[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score)
  const kept: Detection[] = []
  for (const candidate of sorted) {
    const overlaps = kept.some(
      (existing) => existing.class === candidate.class && iou(existing.bbox, candidate.bbox) > threshold,
    )
    if (!overlaps) kept.push(candidate)
  }
  return kept
}
