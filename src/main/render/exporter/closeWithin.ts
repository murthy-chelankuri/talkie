/**
 * The browser and the server that owns its process, closed within the limit. Gated on the server
 * by the caller, not the browser: a failed connect leaves no browser but a process still running.
 */
export function closeBrowserServer(
  browser: { close(): Promise<void> } | null,
  server: { close(): Promise<void>; kill(): Promise<void> | void },
  ms = 5000
): Promise<void> {
  return closeWithin(
    async () => {
      try {
        await browser?.close()
      } finally {
        await server.close()
      }
    },
    () => void server.kill(),
    ms
  )
}

/**
 * Close something that waits for a process to exit, but not for ever. A browser that stalls on
 * its way out would otherwise leave a cancelled export unsettled; past the limit it is killed.
 * Never rejects: the caller is already tearing down.
 */
export async function closeWithin(close: () => Promise<void>, forceKill: () => void, ms = 5000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = Symbol('timed out')
  const outcome = await Promise.race([
    close().then(
      () => undefined,
      () => undefined
    ),
    new Promise<symbol>((resolve) => (timer = setTimeout(() => resolve(timedOut), ms)))
  ])
  clearTimeout(timer)
  if (outcome === timedOut) forceKill()
}
