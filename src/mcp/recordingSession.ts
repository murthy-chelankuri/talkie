import { startRecordingSession, type RecordingSession } from '../main/capture/recordSession'
import { importRecordedSession } from '../main/capture/importRecordedSession'
import { withHistory } from '../main/project/history'
import type { TimelineItem } from '../main/project/timeline/schema'

/**
 * The one browser an agent is recording, and the things it can do to it.
 *
 * One at a time, deliberately. A recording is a video file being written by a real browser
 * window, and a second one would produce two videos with no way to say which clip either
 * belongs to. The server is per-connection, so "one" means one per agent.
 */
let active: RecordingSession | null = null
let busy = false

/**
 * A beat between actions, so the recording is watchable.
 *
 * An agent clicks the instant the last call returns, which records as a blur: the page never
 * settles and a viewer cannot see what happened. Real presenters pause. This is the difference
 * between a recording that documents a click and one that shows it.
 */
const SETTLE_MS = 650

export class NoRecordingError extends Error {
  constructor() {
    super('No recording is in progress. Call talkie_start_recording first.')
  }
}

export function activeRecording(): RecordingSession {
  if (!active) throw new NoRecordingError()
  return active
}

export function isRecording(): boolean {
  return active !== null
}

export async function beginRecording(projectId: string, url: string, baseDir: string): Promise<string> {
  if (active || busy) {
    throw new Error('A recording is already in progress. Stop it before starting another.')
  }

  busy = true
  try {
    active = await startRecordingSession(projectId, url, baseDir)
    await settle()
    return active.sessionId
  } finally {
    busy = false
  }
}

/**
 * Stop, and put the clip on the timeline.
 *
 * The video is already on disk once stop resolves, so an import failure is reported without
 * pretending the recording itself was lost — the file is still there to be imported by hand.
 */
export async function finishRecording(baseDir: string): Promise<TimelineItem> {
  const session = activeRecording()
  if (busy) throw new Error('A stop is already in progress.')

  busy = true
  const { projectId } = session
  try {
    const result = await session.stop()

    return await withHistory(projectId, () => importRecordedSession(projectId, result, baseDir), baseDir)
  } finally {
    active = null
    busy = false
  }
}

/** Abandon the browser without keeping anything, for a run that went wrong. */
export async function discardRecording(): Promise<void> {
  if (!active) return
  const session = active
  active = null
  await session.stop().catch(() => undefined)
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
}

export async function navigate(url: string): Promise<string> {
  const { page } = activeRecording()
  await page.goto(normaliseUrl(url), { waitUntil: 'domcontentloaded' })
  await settle()
  return page.url()
}

/**
 * Click something, named either as a CSS selector or as the words on it.
 *
 * Agents reach for visible text far more readily than for selectors, and a demo is written in
 * terms of what is on screen anyway.
 */
export async function click({ selector, text }: { selector?: string; text?: string }): Promise<void> {
  const { page } = activeRecording()
  const target = locatorFor(page, { selector, text })

  await target.click({ timeout: 15_000 })
  await settle()
}

export async function type({
  selector,
  text,
  value,
  submit
}: {
  selector?: string
  text?: string
  value: string
  submit?: boolean
}): Promise<void> {
  const { page } = activeRecording()
  const target = locatorFor(page, { selector, text })

  await target.click({ timeout: 15_000 })
  // Typed rather than filled: a demo shows the words appearing, and fill() sets them all at once.
  await target.fill('')
  await target.type(value, { delay: 45 })
  if (submit) await page.keyboard.press('Enter')
  await settle()
}

export async function scroll(amount: 'top' | 'bottom' | number): Promise<void> {
  const { page } = activeRecording()

  // Smooth, because a jump cut in a demo reads as a glitch rather than as movement. The body
  // of this function runs in the page, not here, which is why it reaches for globals TypeScript
  // cannot see from a Node build.
  await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((target: 'top' | 'bottom' | number) => {
      const doc = (globalThis as any).document
      const win = (globalThis as any).window
      const to =
        target === 'top' ? 0 : target === 'bottom' ? doc.body.scrollHeight : win.scrollY + Number(target)
      win.scrollTo({ top: to, behavior: 'smooth' })
    }) as (target: 'top' | 'bottom' | number) => void,
    amount
  )
  await settle()
}

export async function waitFor({ seconds, selector }: { seconds?: number; selector?: string }): Promise<void> {
  const { page } = activeRecording()

  if (selector) {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: 30_000 })
  }
  if (seconds) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(seconds, 60) * 1000))
  }
}

export function mark(annotation: 'important' | 'redo' | 'skip'): void {
  activeRecording().markAnnotation(annotation)
}

function locatorFor(
  page: RecordingSession['page'],
  { selector, text }: { selector?: string; text?: string }
): ReturnType<RecordingSession['page']['locator']> {
  if (selector) return page.locator(selector).first()
  if (text) return page.getByText(text, { exact: false }).first()
  throw new Error('Say what to act on: either a CSS `selector` or the visible `text`.')
}

function normaliseUrl(url: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
}
