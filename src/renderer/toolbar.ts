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
 * for the whole app to accommodate one small window.
 */
const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`The toolbar is missing #${id}`)
  return found as T
}

const projectId = new URLSearchParams(window.location.search).get('projectId')
const error = el('error')
const setup = el('setup')
const controls = el('controls')

function show(err: unknown): void {
  error.textContent = err instanceof Error ? err.message : String(err)
  error.hidden = false
}

el<HTMLButtonElement>('start').onclick = async () => {
  if (!projectId) return show(new Error('This toolbar was opened without a project.'))

  try {
    error.hidden = true
    await window.capture.start(projectId, el<HTMLInputElement>('url-input').value)
    setup.hidden = true
    controls.hidden = false
  } catch (err) {
    show(err)
  }
}

for (const kind of ['important', 'redo', 'skip'] as const) {
  el<HTMLButtonElement>(kind).onclick = () => {
    window.capture.mark(kind).catch(show)
  }
}

el<HTMLButtonElement>('stop').onclick = async () => {
  try {
    await window.capture.stop()
    window.capture.close()
  } catch (err) {
    show(err)
  }
}
