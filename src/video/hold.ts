import { ownHold } from './own/hold'

export type Release = () => void

/**
 * Keeps the current frame from being taken until what it needs has arrived: a font, a diagram,
 * a logo's colours, an HTML scene's drawing. The label is what an export that times out names.
 * Releasing is idempotent: releasing on success and again on unmount is the natural way to write a
 * hold that must never be left open, and a second release must not let go of someone else's.
 */
export function hold(label: string, { timeoutMs }: { timeoutMs?: number } = {}): Release {
  return ownHold(label, timeoutMs)
}
