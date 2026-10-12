/**
 * How long an export has left, from how long it has taken so far.
 *
 * Nothing until there is enough to go on: the first few percent are getting ready, which runs at
 * a different rate from drawing frames, and an estimate made from them swings from "an hour" to
 * "a second" before it settles. A wrong number is worse than none.
 */
export function secondsLeft(elapsedMs: number, fraction: number): number | null {
  if (fraction < 0.08 || fraction >= 1 || elapsedMs < 3000) return null
  return Math.max(0, ((elapsedMs / fraction) * (1 - fraction)) / 1000)
}

/** "About 2 min left", rounded the way people say it rather than to the second. */
export function describeTimeLeft(seconds: number | null): string | null {
  if (seconds === null) return null
  if (seconds < 10) return 'Almost done'
  if (seconds < 60) return `About ${Math.ceil(seconds / 10) * 10} sec left`
  return `About ${Math.round(seconds / 60)} min left`
}

/** "1 min 12 sec" — how long a finished export took. */
export function describeDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} sec`
}
