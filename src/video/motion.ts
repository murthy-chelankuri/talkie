/**
 * The motion every scene is drawn with. Our own, written from the physics and from how
 * Remotion's was measured to behave (see docs/superpowers/plans/2026-10-13-own-renderer-step-1-seam.md), so that slides move exactly as
 * they did once Remotion is gone; springSamples.json holds the proof.
 */

export type SpringConfig = { mass: number; stiffness: number; damping: number; overshootClamping: boolean }

const DEFAULT_SPRING: SpringConfig = { mass: 1, stiffness: 100, damping: 10, overshootClamping: false }

/** How close to rest counts as settled, when a spring is fitted into a number of frames. */
const SETTLED = 0.005

/** How far from 0 towards 1 the spring has travelled after this long, starting at rest. */
function position(seconds: number, { mass, stiffness, damping }: SpringConfig): number {
  const natural = Math.sqrt(stiffness / mass)
  const ratio = damping / (2 * Math.sqrt(stiffness * mass))
  // Anything at or past critical damping moves as critically damped. That is what Remotion's did,
  // and every slide Talkie draws uses damping 200, deep in that range.
  if (ratio >= 1) return 1 - Math.exp(-natural * seconds) * (1 + natural * seconds)
  const damped = natural * Math.sqrt(1 - ratio * ratio)
  return 1 - Math.exp(-ratio * natural * seconds) * (Math.cos(damped * seconds) + ((ratio * natural) / damped) * Math.sin(damped * seconds))
}

/** No spring can be further from rest than this after this long, so the search can stop. */
function bound(seconds: number, { mass, stiffness, damping }: SpringConfig): number {
  const natural = Math.sqrt(stiffness / mass)
  const ratio = damping / (2 * Math.sqrt(stiffness * mass))
  if (ratio >= 1) return Math.exp(-natural * seconds) * (1 + natural * seconds)
  const damped = natural * Math.sqrt(1 - ratio * ratio)
  return Math.exp(-ratio * natural * seconds) * Math.sqrt(1 + ((ratio * natural) / damped) ** 2)
}

const settledAt = new Map<string, number>()

/** One past the last whole frame at which the spring is still visibly moving. */
function naturalFrames(fps: number, config: SpringConfig): number {
  const key = `${fps}:${config.mass}:${config.stiffness}:${config.damping}`
  const known = settledAt.get(key)
  if (known !== undefined) return known
  let last = 0
  for (let frame = 0; bound(frame / fps, config) >= SETTLED; frame++) {
    if (Math.abs(1 - position(frame / fps, config)) >= SETTLED) last = frame + 1
  }
  settledAt.set(key, last)
  return last
}

export function spring({
  frame,
  fps,
  config = {},
  durationInFrames
}: {
  frame: number
  fps: number
  config?: Partial<SpringConfig>
  /** Fits the spring's movement into this many frames, however long it would naturally take. */
  durationInFrames?: number
}): number {
  const settings = { ...DEFAULT_SPRING, ...config }
  if (frame <= 0) return 0
  let at = frame
  if (durationInFrames !== undefined) {
    if (frame > durationInFrames) return 1
    at = (frame * naturalFrames(fps, settings)) / durationInFrames
  }
  const value = position(at / fps, settings)
  return settings.overshootClamping ? Math.min(value, 1) : value
}

export type Extrapolate = 'clamp' | 'extend'

export function interpolate(
  value: number,
  input: readonly number[],
  output: readonly number[],
  { extrapolateLeft = 'extend', extrapolateRight = 'extend' }: { extrapolateLeft?: Extrapolate; extrapolateRight?: Extrapolate } = {}
): number {
  // A mismatched range would draw something plausible and wrong, which is worse than an error.
  if (input.length !== output.length) throw new Error(`interpolate needs ranges of one length, not ${input.length} and ${output.length}`)
  if (input.length < 2) throw new Error('interpolate needs at least two points')
  for (let i = 1; i < input.length; i++) {
    if (!(input[i] > input[i - 1])) throw new Error(`interpolate needs a strictly increasing input range, not [${input.join(', ')}]`)
  }

  const last = input.length - 1
  if (value < input[0] && extrapolateLeft === 'clamp') return output[0]
  if (value > input[last] && extrapolateRight === 'clamp') return output[last]

  let segment = 0
  while (segment < last - 1 && value >= input[segment + 1]) segment++
  const progress = (value - input[segment]) / (input[segment + 1] - input[segment])
  return output[segment] + progress * (output[segment + 1] - output[segment])
}
