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
