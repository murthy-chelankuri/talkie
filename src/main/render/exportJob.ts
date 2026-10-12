import { makeCancelSignal, type CancelSignal } from '@remotion/renderer'
import type { ExportProgress, ExportResult } from './exportProgress'
import type { RenderOptions } from './renderProject'

type Render = (id: string, options: RenderOptions) => Promise<string>

/** The export running for each project, so Cancel can find it. One at a time per project. */
const running = new Map<string, { cancel: () => void; settled: Promise<unknown> }>()

export async function runExport(
  id: string,
  render: Render,
  onProgress: (progress: ExportProgress) => void,
  now: () => number = Date.now
): Promise<ExportResult> {
  if (running.has(id)) return { status: 'failed', message: 'This project is already being exported.' }

  const { cancelSignal, cancel } = makeCancelSignal()
  let cancelled = false
  const started = now()
  const rendered = render(id, { onProgress, cancelSignal: cancelSignal as CancelSignal })
  running.set(id, {
    cancel: () => {
      cancelled = true
      cancel()
    },
    settled: rendered.catch(() => undefined)
  })
  try {
    const path = await rendered
    // A cancel that lands after the last frame cannot stop the file being written; it is done.
    return { status: 'done', path, seconds: Math.round((now() - started) / 1000) }
  } catch (err) {
    if (cancelled) return { status: 'cancelled' }
    return { status: 'failed', message: err instanceof Error ? err.message : String(err) }
  } finally {
    running.delete(id)
  }
}

/** Whether there was an export to stop. */
export function cancelExport(id: string): boolean {
  const job = running.get(id)
  job?.cancel()
  return Boolean(job)
}

export function exportsRunning(): boolean {
  return running.size > 0
}

/**
 * Stop every export and wait for each to put its browser away, up to a limit.
 *
 * For quitting. An export renders in browsers of its own, and quitting under one left them
 * running with no parent: five were found holding 4GB between them, the oldest two days old.
 * Cancelling is what closes them, so the app cancels and waits before it goes.
 */
export async function cancelAllExports(waitMs = 5000): Promise<void> {
  const jobs = [...running.values()]
  for (const job of jobs) job.cancel()
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.allSettled(jobs.map((job) => job.settled)),
    new Promise((resolve) => (timer = setTimeout(resolve, waitMs)))
  ])
  clearTimeout(timer)
}
