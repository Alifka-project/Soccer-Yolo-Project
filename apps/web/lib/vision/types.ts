export type ObjectClass = 'person' | 'ball'
export type VisionTeam = 'team_a' | 'team_b' | 'ball' | 'unknown'

/** Axis-aligned box in source-video pixel space: [x, y, width, height]. */
export type Box = [number, number, number, number]

export interface Detection {
  bbox: Box
  score: number
  class: ObjectClass
}

export interface TrackedObject {
  id: number
  bbox: Box
  score: number
  class: ObjectClass
  /** Frames since the track was created. */
  age: number
  /** Number of frames the track was matched to a detection. */
  hits: number
  /** Frames since the last successful match (0 when just updated). */
  missed: number
  velocity: [number, number]
  team: VisionTeam
  color?: string
  /** True when the box is a motion-model prediction rather than a fresh detection. */
  coasted: boolean
}

export interface FrameResult {
  frameId: number
  timestamp: number
  width: number
  height: number
  objects: TrackedObject[]
  inferenceMs: number
}

export function boxCenter(box: Box) {
  return { x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 }
}

export function iou(a: Box, b: Box) {
  const ax2 = a[0] + a[2]
  const ay2 = a[1] + a[3]
  const bx2 = b[0] + b[2]
  const by2 = b[1] + b[3]
  const interW = Math.min(ax2, bx2) - Math.max(a[0], b[0])
  const interH = Math.min(ay2, by2) - Math.max(a[1], b[1])
  if (interW <= 0 || interH <= 0) return 0
  const inter = interW * interH
  const union = a[2] * a[3] + b[2] * b[3] - inter
  return union > 0 ? inter / union : 0
}
