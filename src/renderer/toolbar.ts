import '@fontsource-variable/geist'
import './src/styles/index.css'
import type { CaptureToolbarApi } from '../preload/toolbar'

declare global {
  interface Window {
    capture: CaptureToolbarApi
  }
}

/**
 * The recording toolbar.
 *
 * A module rather than an inline script, so the window is covered by the same
 * Content-Security-Policy as everything else — an inline script would need the policy loosened
 * for the whole app to accommodate one small window. It pulls in the app's stylesheet rather
 * than carrying its own copy of the palette, because a second set of colours is a set that
 * drifts.
 */
const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`The toolbar is missing #${id}`)
  return found as T
}

/** The editor's choice, so the two windows are not different colours side by side. */
function applyTheme(): void {
  let stored: string | null = null
  try {
    stored = localStorage.getItem('demo-editor-theme')
  } catch {
    // A window with no storage still has to render.
  }
  // Dark unless light was chosen, as in the editor: Studio is designed dark first.
  const dark = stored !== 'light'
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

applyTheme()

const projectId = new URLSearchParams(window.location.search).get('projectId')
const error = el('error')
const setup = el('setup')
const controls = el('controls')
const elapsed = el('elapsed')
const marks = el('marks')
const exploreBox = el<HTMLInputElement>('explore')
const exploring = el('exploring')

/**
 * What the automatic walk is doing.
 *
 * A browser that moves on its own is alarming unless it says why, and a browser that has gone
 * still is indistinguishable from one that has hung — which matters most in the one case where
 * the answer is "it is waiting for you to type your password". That case is marked, so it reads
 * as a request rather than as more progress.
 */
/**
 * A recording that ended by itself: the browser was closed, or the import found nowhere to put
 * it. The window goes back to where a new one can be started and says why, because a toolbar
 * still counting up at a browser that has gone is worse than no toolbar at all.
 */
window.capture.onEnded((reason, failed) => {
  clearInterval(ticking)
  controls.hidden = true
  setup.hidden = false
  exploring.hidden = true

  if (failed) {
    show(new Error(reason))
    return
  }

  // Finished properly: said in the hint line rather than the error banner, so a recording that
  // worked does not arrive looking like one that did not.
  error.hidden = true
  const hint = el('setup-hint')
  hint.hidden = false
  hint.textContent = reason
})

window.capture.onExploring((status, needsYou) => {
  exploring.textContent = needsYou ? `⚠ ${status}` : status
  // Accent text on the surface clears the 5.8:1 floor for small accent text in both themes —
  // 7.62:1 light, 7.67:1 dark; see contrast.test.ts.
  exploring.className = needsYou
    ? 'mt-auto rounded-[10px] bg-surface px-2 py-1.5 text-[11px] font-medium leading-relaxed text-accent ring-1 ring-inset ring-accent'
    : 'mt-auto text-[11px] leading-relaxed text-text-muted'
  exploring.hidden = false
})
const startButton = el<HTMLButtonElement>('start')
const urlInput = el<HTMLInputElement>('url-input')

const MARK_LABELS = { important: 'Important', redo: 'Redo', skip: 'Skip' } as const
let startedAt = 0
let counted = 0
let ticking = 0

function show(err: unknown): void {
  error.textContent = err instanceof Error ? err.message : String(err)
  error.hidden = false
  // The window cannot grow to hold both, and an error that has just stopped the recording
  // starting matters more than a description of what recording is.
  el('setup-hint').hidden = true
}

urlInput.focus()

startButton.onclick = async () => {
  if (!projectId) return show(new Error('This toolbar was opened without a project.'))

  // A second press while the browser is still opening starts a second session, which the main
  // process refuses — so the button says what is happening instead of looking ignored.
  startButton.disabled = true
  startButton.textContent = 'Opening the browser…'
  try {
    error.hidden = true
    await window.capture.start(projectId, urlInput.value, exploreBox.checked)
    startedAt = Date.now()
    elapsed.textContent = '0:00'
    // Kept so it can be stopped. Left running, the clock counted on past the end of a recording
    // that had already finished, which is the sort of thing that makes a window look broken.
    clearInterval(ticking)
    ticking = window.setInterval(() => {
      elapsed.textContent = clock(Date.now() - startedAt)
    }, 500)
    setup.hidden = true
    controls.hidden = false
  } catch (err) {
    show(err)
  } finally {
    startButton.disabled = false
    startButton.textContent = 'Start recording'
  }
}

urlInput.onkeydown = (event) => {
  if (event.key === 'Enter') startButton.click()
}

for (const kind of ['important', 'redo', 'skip'] as const) {
  el<HTMLButtonElement>(kind).onclick = () => {
    // Written down before the call resolves: the note belongs to the moment it was pressed, and
    // saying so straight away is what tells the person it landed.
    const at = clock(Date.now() - startedAt)
    counted += 1
    marks.textContent = `${MARK_LABELS[kind]} at ${at}${counted > 1 ? ` · ${counted} notes` : ''}`
    window.capture.mark(kind).catch(show)
  }
}

el<HTMLButtonElement>('stop').onclick = async () => {
  const stop = el<HTMLButtonElement>('stop')
  stop.disabled = true
  stop.textContent = 'Saving…'
  try {
    await window.capture.stop()
    window.capture.close()
  } catch (err) {
    show(err)
    stop.disabled = false
    stop.textContent = 'Stop'
  }
}
