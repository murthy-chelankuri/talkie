import type { Release } from '../hold'

/** Remotion's delayRender gave up after 30 s; so does this, so a stuck asset fails rather than hangs. */
const DEFAULT_TIMEOUT_MS = 30_000

type Open = { label: string; opened: number; timeoutMs: number }

const open = new Map<number, Open>()
let next = 1
/** Sticky for the life of the page, on purpose: one page is one export tab, and a failed page is closed. */
let failure: string | null = null

export function ownHold(label: string, timeoutMs: number = DEFAULT_TIMEOUT_MS, now: () => number = Date.now): Release {
  const id = next++
  open.set(id, { label, opened: now(), timeoutMs })
  let released = false
  return () => {
    if (released) return
    released = true
    open.delete(id)
  }
}

/** Something a frame needs will never arrive. The next wait fails with this, at once. */
export function reportFailure(message: string): void {
  failure ??= message
}

export function openHoldCount(): number {
  return open.size
}

/**
 * Resolves once nothing is held. Rejects with a reported failure, or naming the first hold that
 * has outlived its timeout — the export fails with that label rather than waiting for ever.
 */
export async function whenSettled({
  now = Date.now,
  wait = () => new Promise<void>((resolve) => setTimeout(resolve, 4))
}: { now?: () => number; wait?: () => Promise<void> } = {}): Promise<void> {
  for (;;) {
    if (failure) throw new Error(failure)
    if (open.size === 0) return
    const overdue = [...open.values()].find((hold) => now() - hold.opened > hold.timeoutMs)
    if (overdue) throw new Error(`${overdue.label} did not finish within ${Math.round(overdue.timeoutMs / 1000)} s`)
    await wait()
  }
}

export function resetHolds(): void {
  open.clear()
  failure = null
}
