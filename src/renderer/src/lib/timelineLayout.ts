// Tick spacing ladder, in seconds. The timeline picks the first one that keeps labels from
// colliding at the current zoom.
const TICK_INTERVALS_SECONDS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
const MIN_TICK_SPACING_PX = 60

export function chooseTickIntervalSeconds(pixelsPerSecond: number): number {
  const fitting = TICK_INTERVALS_SECONDS.find(
    (seconds) => seconds * pixelsPerSecond >= MIN_TICK_SPACING_PX
  )
  return fitting ?? TICK_INTERVALS_SECONDS[TICK_INTERVALS_SECONDS.length - 1]
}

export function frameAtOffset(
  offsetPx: number,
  pixelsPerSecond: number,
  fps: number,
  totalFrames: number
): number {
  if (totalFrames <= 0) return 0
  const frame = Math.round((offsetPx / pixelsPerSecond) * fps)
  return Math.min(Math.max(frame, 0), totalFrames - 1)
}

export function offsetAtFrame(frame: number, pixelsPerSecond: number, fps: number): number {
  return (frame / fps) * pixelsPerSecond
}

export function formatTimecode(seconds: number): string {
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}

/** "0:02.9" — the video's time to the tenth, the same precision as the scene clock beside it. */
export function formatPreciseTimecode(seconds: number): string {
  const tenths = Math.floor(Math.max(seconds, 0) * 10)
  const whole = Math.floor(tenths / 10)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${tenths % 10}`
}

export interface ClipBounds {
  start: number
  duration: number
}

// Skipping back lands on the start of the clip you are inside, unless you are already there, in
// which case it steps to the clip before — the behaviour a transport control is expected to have.
export function previousClipStart(clips: ClipBounds[], frame: number): number | null {
  const starts = clips.map((clip) => clip.start).sort((a, b) => a - b)
  const current = [...starts].reverse().find((start) => start <= frame)
  if (current === undefined) return null
  if (frame > current) return current

  const earlier = [...starts].reverse().find((start) => start < frame)
  return earlier ?? null
}

/** The scene a frame falls in, how far in it is, and how long the scene is. */
export interface ScenePosition<T extends ClipBounds> {
  clip: T
  offset: number
  duration: number
}

// Narration is timed from the start of its own clip (`[4.2]` is 4.2 seconds into the scene), so
// the clock that helps write it counts from there rather than from the start of the video.
export function sceneAt<T extends ClipBounds>(clips: T[], frame: number): ScenePosition<T> | null {
  const sorted = [...clips].sort((a, b) => a.start - b.start)
  for (let index = sorted.length - 1; index >= 0; index--) {
    const clip = sorted[index]
    if (clip.start > frame) continue
    if (frame >= clip.start + clip.duration) return null
    return { clip, offset: frame - clip.start, duration: clip.duration }
  }
  return null
}

/** Seconds in tenths, the precision a timing in the narration is written to: "4.2". */
export function formatSceneSeconds(seconds: number): string {
  return (Math.floor(Math.max(seconds, 0) * 10) / 10).toFixed(1)
}

export function nextClipStart(clips: ClipBounds[], frame: number): number | null {
  return clips.map((clip) => clip.start).sort((a, b) => a - b).find((start) => start > frame) ?? null
}
