/**
 * Video time for a page that was written against the wall clock.
 *
 * Remotion renders frames out of order across several tabs, so anything a page times by the real
 * clock lands somewhere different in every frame. Inside a scene, the clock is this one: it only
 * moves when the video says where it is, and everything that reads or waits on time reads it.
 */
interface Timer { id: number; at: number; every?: number; fn: () => void }

export function createClock(): { epoch: number; now(): number; install(target: any): void; advanceTo(ms: number): void } {
  const epoch = Date.UTC(2026, 0, 1)
  let now = 0
  let nextId = 1
  let timers: Timer[] = []
  let frameCallbacks = new Map<number, (t: number) => void>()

  return {
    epoch,
    now: () => now,
    install(target) {
      const RealDate = target.Date
      class VideoDate extends RealDate {
        constructor(...args: any[]) { super(...((args.length ? args : [epoch + now]) as [])) }
        static now(): number { return epoch + now }
      }
      target.Date = VideoDate
      target.performance = Object.assign(Object.create(target.performance ?? {}), { now: () => now })
      target.setTimeout = (fn: () => void, ms = 0) => { const id = nextId++; timers.push({ id, at: now + Math.max(0, ms), fn }); return id }
      target.setInterval = (fn: () => void, ms = 0) => { const id = nextId++; const every = Math.max(1, ms); timers.push({ id, at: now + every, every, fn }); return id }
      target.clearTimeout = target.clearInterval = (id: number) => { timers = timers.filter((t) => t.id !== id) }
      target.requestAnimationFrame = (fn: (t: number) => void) => { const id = nextId++; frameCallbacks.set(id, fn); return id }
      target.cancelAnimationFrame = (id: number) => { frameCallbacks.delete(id) }
    },
    advanceTo(ms) {
      // Backwards is a fresh look at an earlier moment: timers set for later stay where they are.
      for (;;) {
        const due = timers.filter((t) => t.at <= ms).sort((a, b) => a.at - b.at || a.id - b.id)[0]
        if (!due) break
        now = Math.max(now, due.at)
        if (due.every) due.at += due.every
        else timers = timers.filter((t) => t !== due)
        due.fn()
      }
      now = ms
      const callbacks = frameCallbacks
      frameCallbacks = new Map()
      for (const fn of callbacks.values()) fn(ms)
    }
  }
}
