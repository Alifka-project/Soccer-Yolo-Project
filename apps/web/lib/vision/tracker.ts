import type { Box, Detection, ObjectClass, TrackedObject } from './types'
import { boxCenter, iou } from './types'

interface TrackerOptions {
  /** Frames a person track survives without a matching detection. */
  personMaxAge?: number
  /** The ball is small and fast, so it is allowed to coast for longer. */
  ballMaxAge?: number
  /** Matches below this affinity are rejected outright. */
  minAffinity?: number
  /** Detections needed before a track is reported downstream. */
  minHits?: number
}

interface InternalTrack extends TrackedObject {
  lastSeenFrame: number
}

/**
 * Greedy IoU + centroid tracker.
 *
 * Affinity blends overlap with centre distance so that the ball — which can
 * move further than its own width between frames, giving zero IoU — still
 * matches, while crowded players are separated by overlap.
 */
export class MultiObjectTracker {
  private tracks: InternalTrack[] = []
  private nextId = 1
  private frameId = 0
  private options: Required<TrackerOptions>

  constructor(options: TrackerOptions = {}) {
    this.options = {
      personMaxAge: options.personMaxAge ?? 12,
      ballMaxAge: options.ballMaxAge ?? 20,
      minAffinity: options.minAffinity ?? 0.18,
      minHits: options.minHits ?? 2,
    }
  }

  reset() {
    this.tracks = []
    this.nextId = 1
    this.frameId = 0
  }

  get currentFrame() {
    return this.frameId
  }

  update(detections: Detection[]): TrackedObject[] {
    this.frameId++

    const predictions = this.tracks.map((track) => ({
      track,
      box: predict(track),
    }))

    const pairs: Array<{ t: number; d: number; affinity: number }> = []
    predictions.forEach((prediction, t) => {
      detections.forEach((detection, d) => {
        if (detection.class !== prediction.track.class) return
        const affinity = affinityOf(prediction.box, detection.bbox, detection.class)
        if (affinity >= this.options.minAffinity) pairs.push({ t, d, affinity })
      })
    })
    pairs.sort((a, b) => b.affinity - a.affinity)

    const usedTracks = new Set<number>()
    const usedDetections = new Set<number>()
    for (const pair of pairs) {
      if (usedTracks.has(pair.t) || usedDetections.has(pair.d)) continue
      usedTracks.add(pair.t)
      usedDetections.add(pair.d)
      this.applyMatch(predictions[pair.t].track, detections[pair.d])
    }

    predictions.forEach((prediction, index) => {
      if (usedTracks.has(index)) return
      const track = prediction.track
      track.bbox = prediction.box
      track.missed++
      track.age++
      track.coasted = true
      // Bleed off velocity so a lost track drifts to a stop instead of flying away.
      track.velocity = [track.velocity[0] * 0.7, track.velocity[1] * 0.7]
    })

    detections.forEach((detection, index) => {
      if (usedDetections.has(index)) return
      this.tracks.push({
        id: this.nextId++,
        bbox: detection.bbox,
        score: detection.score,
        class: detection.class,
        age: 1,
        hits: 1,
        missed: 0,
        velocity: [0, 0],
        team: detection.class === 'ball' ? 'ball' : 'unknown',
        coasted: false,
        lastSeenFrame: this.frameId,
      })
    })

    this.tracks = this.tracks.filter((track) => {
      const maxAge = track.class === 'ball' ? this.options.ballMaxAge : this.options.personMaxAge
      return track.missed <= maxAge
    })

    // Only one ball can be in play; keep the best-supported track.
    const balls = this.tracks.filter((track) => track.class === 'ball')
    if (balls.length > 1) {
      const best = balls.reduce((a, b) => (b.hits - b.missed > a.hits - a.missed ? b : a))
      this.tracks = this.tracks.filter((track) => track.class !== 'ball' || track === best)
    }

    return this.tracks
      .filter((track) => track.hits >= this.options.minHits || track.class === 'ball')
      .map((track) => ({ ...track }))
  }

  /** Lets the team classifier write its decision back onto the live tracks. */
  assignTeam(id: number, team: TrackedObject['team'], color?: string) {
    const track = this.tracks.find((item) => item.id === id)
    if (!track) return
    track.team = team
    if (color) track.color = color
  }

  snapshot(): TrackedObject[] {
    return this.tracks.map((track) => ({ ...track }))
  }

  private applyMatch(track: InternalTrack, detection: Detection) {
    const previous = boxCenter(track.bbox)
    const next = boxCenter(detection.bbox)
    // Light smoothing: enough to settle detector jitter, not enough to lag a sprint.
    const smoothing = track.class === 'ball' ? 0.75 : 0.6
    const blended: Box = [
      track.bbox[0] + (detection.bbox[0] - track.bbox[0]) * smoothing,
      track.bbox[1] + (detection.bbox[1] - track.bbox[1]) * smoothing,
      track.bbox[2] + (detection.bbox[2] - track.bbox[2]) * 0.4,
      track.bbox[3] + (detection.bbox[3] - track.bbox[3]) * 0.4,
    ]
    track.velocity = [
      track.velocity[0] * 0.5 + (next.x - previous.x) * 0.5,
      track.velocity[1] * 0.5 + (next.y - previous.y) * 0.5,
    ]
    track.bbox = blended
    track.score = detection.score
    track.hits++
    track.age++
    track.missed = 0
    track.coasted = false
    track.lastSeenFrame = this.frameId
  }
}

function predict(track: InternalTrack): Box {
  return [
    track.bbox[0] + track.velocity[0],
    track.bbox[1] + track.velocity[1],
    track.bbox[2],
    track.bbox[3],
  ]
}

function affinityOf(predicted: Box, detected: Box, cls: ObjectClass) {
  const overlap = iou(predicted, detected)
  const a = boxCenter(predicted)
  const b = boxCenter(detected)
  const distance = Math.hypot(a.x - b.x, a.y - b.y)
  const reference = Math.max(predicted[2], predicted[3], 8)
  // The ball routinely travels several body-widths per frame; players do not.
  const maxDistance = cls === 'ball' ? reference * 12 : reference * 2.2
  const proximity = Math.max(0, 1 - distance / maxDistance)
  return cls === 'ball' ? proximity * 0.85 + overlap * 0.15 : overlap * 0.7 + proximity * 0.3
}
