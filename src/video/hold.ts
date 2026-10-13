import { continueRender, delayRender } from 'remotion'

export type Release = () => void

/**
 * Keeps the current frame from being taken until what it needs has arrived: a font, a diagram,
 * a logo's colours, an HTML scene's drawing. The label is what an export that times out names.
 *
 * Delegates to Remotion until step 3 of the renderer brings Talkie's own export.
 */
export function hold(label: string, { timeoutMs }: { timeoutMs?: number } = {}): Release {
  const handle = delayRender(label, timeoutMs === undefined ? undefined : { timeoutInMilliseconds: timeoutMs })
  let released = false
  // Idempotent because releasing on success and again on unmount is the natural way to write a
  // hold that must never be left open, and a second release must not let go of someone else's.
  return () => {
    if (released) return
    released = true
    continueRender(handle)
  }
}
