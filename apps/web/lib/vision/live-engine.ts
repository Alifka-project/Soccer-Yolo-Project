import { LiveDetector, type DetectorQuality, type DetectorStatus } from './detector'
import { MultiObjectTracker } from './tracker'
import { TeamClassifier } from './team-classifier'
import type { TrackedObject } from './types'
import { boxCenter } from './types'

export interface LiveFrame {
  frame_id: number
  timestamp: number
  media_time: number
  fps: number
  resolution: [number, number]
  team_colors: { team_a: string; team_b: string } | null
  tracking_data: Array<{
    track_id: number
    bbox: [number, number, number, number]
    class: string
    confidence: number
    center: [number, number]
    team: string
    color?: string
    coasted: boolean
    /** Source-pixel displacement per detection tick, for between-frame extrapolation. */
    velocity: [number, number]
  }>
  analysis_fps: number
  inference_ms: number
  /** Wall-clock gap between the last two detections, in milliseconds. */
  detection_interval_ms: number
}

export interface LiveStatus extends DetectorStatus {
  running: boolean
  analysisFps: number
  inferenceMs: number
  detectedPlayers: number
  ballDetected: boolean
}

interface EngineOptions {
  onFrame: (frame: LiveFrame) => void
  onStatus: (status: LiveStatus) => void
  quality?: DetectorQuality
  /** Upper bound on analysis rate; inference cost usually binds first. */
  targetFps?: number
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: { mediaTime: number; presentedFrames: number }) => void,
  ) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/**
 * Drives detection, tracking and team assignment straight off a playing
 * <video>, so analytics stream while the clip plays instead of requiring a
 * separate batch job to finish first.
 */
export class LiveAnalysisEngine {
  private detector: LiveDetector
  private tracker = new MultiObjectTracker()
  private teams = new TeamClassifier()
  private video: FrameCallbackVideo | null = null
  private options: EngineOptions
  private running = false
  private busy = false
  private rafHandle: number | null = null
  private vfcHandle: number | null = null
  private timerHandle: ReturnType<typeof setTimeout> | null = null
  private lastAnalysisAt = 0
  private analysisFps = 0
  private inferenceMs = 0
  private lastMediaTime = -1
  private fpsEstimate = 30
  private firstMeta: { mediaTime: number; presentedFrames: number } | null = null
  private lastFrameSignature = ''
  private slowFrames = 0
  private autoQuality = true
  private detectionIntervalMs = 120

  constructor(options: EngineOptions) {
    this.options = options
    this.detector = new LiveDetector(options.quality || 'balanced')
  }

  get isRunning() {
    return this.running
  }

  get videoFps() {
    return this.fpsEstimate
  }

  attach(video: HTMLVideoElement) {
    if (this.video === video) return
    this.stop()
    this.video = video as FrameCallbackVideo
    this.reset()
    if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
      ;(window as any).__soccerEngine = this
    }
  }

  /** Times back-to-back inference passes on the current frame (dev diagnostics). */
  async benchmark(passes = 8) {
    const video = this.video
    if (!video) return null
    await this.detector.load()
    const samples: number[] = []
    for (let i = 0; i < passes; i++) {
      const started = performance.now()
      await this.detector.detect(video, 640)
      samples.push(performance.now() - started)
    }
    const sorted = [...samples].sort((a, b) => a - b)
    return {
      quality: this.detector.status.quality,
      backend: this.detector.status.backend,
      medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]),
      minMs: Math.round(sorted[0]),
      maxMs: Math.round(sorted[sorted.length - 1]),
      impliedFps: Math.round((1000 / sorted[Math.floor(sorted.length / 2)]) * 10) / 10,
    }
  }

  detach() {
    this.stop()
    this.video = null
  }

  reset() {
    this.tracker.reset()
    this.teams.reset()
    this.lastMediaTime = -1
    this.firstMeta = null
    this.lastFrameSignature = ''
  }

  setQuality(quality: DetectorQuality) {
    // An explicit choice from the user turns off automatic downgrading.
    this.autoQuality = false
    this.slowFrames = 0
    this.detector.setQuality(quality)
    this.emitStatus(0, false)
  }

  /**
   * Drops to a cheaper tiling when inference cannot sustain a usable rate.
   *
   * A wide-shot clip on an integrated GPU can spend most of a second per frame
   * at four tiles, which makes the overlay lag the play badly. Fewer, larger
   * tiles lose some distant players but keep the dashboard live.
   */
  private considerDowngrade(inferenceMs: number) {
    if (!this.autoQuality) return
    const current = this.detector.status.quality
    if (current === 'fast') return
    this.slowFrames = inferenceMs > 400 ? this.slowFrames + 1 : 0
    if (this.slowFrames >= 4) {
      this.slowFrames = 0
      this.detector.setQuality(current === 'accurate' ? 'balanced' : 'fast')
    }
  }

  /** Warms the model up front so the first play does not stall on a download. */
  async preload() {
    this.emitStatus(0, false)
    try {
      await this.detector.load()
    } catch {
      // Status already carries the error message.
    }
    this.emitStatus(0, false)
  }

  start() {
    if (this.running || !this.video) return
    this.running = true
    this.emitStatus(0, false)
    void this.detector.load().catch(() => this.emitStatus(0, false))
    this.schedule()
  }

  stop() {
    this.running = false
    if (this.rafHandle != null) {
      cancelAnimationFrame(this.rafHandle)
      this.rafHandle = null
    }
    if (this.vfcHandle != null && this.video?.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.vfcHandle)
      this.vfcHandle = null
    }
    if (this.timerHandle != null) {
      clearTimeout(this.timerHandle)
      this.timerHandle = null
    }
    this.emitStatus(0, false)
  }

  /** Analyses the frame currently displayed, even while paused or after a seek. */
  async analyzeCurrentFrame() {
    if (!this.video) return
    this.lastFrameSignature = ''
    this.lastAnalysisAt = 0
    await this.tick(this.video.currentTime)
  }

  /**
   * True when a jump is large enough that tracks cannot be carried across it.
   * Scrubbing a fraction of a second keeps identities; jumping to another
   * passage of play does not.
   */
  isDiscontinuous(mediaTime: number, thresholdSeconds = 1) {
    if (this.lastMediaTime < 0) return true
    return Math.abs(mediaTime - this.lastMediaTime) > thresholdSeconds
  }

  private schedule() {
    if (!this.running || !this.video) return
    const video = this.video

    if (video.requestVideoFrameCallback) {
      this.vfcHandle = video.requestVideoFrameCallback((_now, metadata) => {
        this.vfcHandle = null
        this.updateFpsEstimate(metadata)
        void this.tick(metadata.mediaTime).finally(() => this.schedule())
      })
      return
    }

    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null
      void this.tick(video.currentTime).finally(() => this.schedule())
    })
  }

  private updateFpsEstimate(metadata: { mediaTime: number; presentedFrames: number }) {
    if (!this.firstMeta) {
      this.firstMeta = metadata
      return
    }
    const dt = metadata.mediaTime - this.firstMeta.mediaTime
    const frames = metadata.presentedFrames - this.firstMeta.presentedFrames
    if (dt > 0.75 && frames > 5) {
      const estimate = frames / dt
      if (estimate > 5 && estimate < 121) {
        this.fpsEstimate = Math.round(estimate * 10) / 10
      }
    }
  }

  private async tick(mediaTime: number) {
    const video = this.video
    if (!video || this.busy) return
    if (video.readyState < 2 || !video.videoWidth) return

    const targetFps = this.options.targetFps ?? 12
    const now = performance.now()
    if (now - this.lastAnalysisAt < 1000 / targetFps) return

    // Skip repeats: a paused video hands back the same frame every callback.
    const signature = `${mediaTime.toFixed(3)}`
    if (signature === this.lastFrameSignature) return

    this.busy = true
    try {
      const result = await this.detector.detect(video, 640)
      if (!result) return

      this.lastFrameSignature = signature
      const sincePrevious = this.lastAnalysisAt > 0 ? now - this.lastAnalysisAt : 0
      if (sincePrevious > 0 && sincePrevious < 4000) {
        this.detectionIntervalMs = this.detectionIntervalMs * 0.6 + sincePrevious * 0.4
      }
      if (sincePrevious > 0) {
        const instant = 1000 / sincePrevious
        this.analysisFps = this.analysisFps > 0
          ? Math.round((this.analysisFps * 0.7 + instant * 0.3) * 10) / 10
          : Math.round(instant * 10) / 10
      }
      this.lastAnalysisAt = now
      this.inferenceMs = Math.round(result.inferenceMs)
      this.considerDowngrade(result.inferenceMs)

      const tracked = this.tracker.update(result.detections)
      const labeled = this.teams.update(result.image, result.imageScale, tracked)
      labeled.forEach((object) => this.tracker.assignTeam(object.id, object.team, object.color))

      this.lastMediaTime = mediaTime
      const frameId = Math.max(0, Math.round(mediaTime * this.fpsEstimate))
      this.options.onFrame(this.toFrame(frameId, mediaTime, labeled, result.width, result.height))
      // Count only players seen in this frame. Including coasted tracks — ones
      // being carried by the motion model through an occlusion — inflated the
      // figure past the number of people who can be on a pitch.
      this.emitStatus(
        labeled.filter((o) => o.class === 'person' && !o.coasted).length,
        labeled.some((o) => o.class === 'ball' && !o.coasted),
      )
    } catch (error) {
      console.warn('Live analysis frame failed', error)
    } finally {
      this.busy = false
    }
  }

  private toFrame(
    frameId: number,
    mediaTime: number,
    objects: TrackedObject[],
    width: number,
    height: number,
  ): LiveFrame {
    return {
      frame_id: frameId,
      timestamp: Date.now() / 1000,
      media_time: mediaTime,
      fps: this.fpsEstimate,
      resolution: [width, height],
      team_colors: this.teams.teamColors,
      analysis_fps: this.analysisFps,
      inference_ms: this.inferenceMs,
      detection_interval_ms: this.detectionIntervalMs,
      tracking_data: objects.map((object) => {
        const center = boxCenter(object.bbox)
        return {
          track_id: object.id,
          bbox: object.bbox,
          class: object.class,
          confidence: object.score,
          center: [center.x, center.y] as [number, number],
          team: object.team,
          color: object.color,
          coasted: object.coasted,
          velocity: object.velocity,
        }
      }),
    }
  }

  private emitStatus(players: number, ball: boolean) {
    this.options.onStatus({
      ...this.detector.status,
      running: this.running,
      analysisFps: this.analysisFps,
      inferenceMs: this.inferenceMs,
      detectedPlayers: players,
      ballDetected: ball,
    })
  }
}
