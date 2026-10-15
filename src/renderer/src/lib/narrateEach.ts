/**
 * Speaks every clip in turn, and on past one that fails, returning what went wrong with each.
 *
 * It used to stop at the first failure, so one line the voice could not read left every scene
 * after it silent — which looked like a voice that gave up a few scenes in, and an export with no
 * narration from there on.
 */
export async function narrateEach<T>(
  items: T[],
  narrate: (item: T) => Promise<void>,
  onStart: (item: T) => void = () => undefined
): Promise<string[]> {
  const failures: string[] = []
  for (const item of items) {
    onStart(item)
    try {
      await narrate(item)
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err))
    }
  }
  return failures
}

/** What to say about the clips that could not be spoken, or null when every one was. */
export function describeNarrationFailures(failures: string[]): string | null {
  if (failures.length === 0) return null
  if (failures.length === 1) return failures[0]
  return `${failures.length} clips could not be spoken. ${failures.join(' ')}`
}
