/**
 * A promise, or the signal's reason if it aborts first.
 *
 * Not `Promise.race([work, aborted])` against one long-lived promise: every race leaves a reaction
 * on a promise that never settles, and each reaction holds its race's result. The export raced
 * every frame's screenshot against the tab crashing, so every frame of the video, as a base64
 * JPEG, stayed reachable until the export ended — about 100 KB a frame, and a twenty-minute video
 * ran Node out of memory just before its last frame. Here the listener goes as the work settles.
 */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    work.catch(() => undefined)
    return Promise.reject(signal.reason)
  }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      }
    )
  })
}
