import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { randomUUID } from 'crypto'
import { mkdirSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { findProjectDir } from '../project/paths'
import { appendActionLogEntry, type ActionLogEntry } from './actionLog'
import { shouldRedactInputValue } from './redact'

export interface RecordingSession {
  sessionId: string
  projectId: string
  page: Page
  markAnnotation: (annotation: 'important' | 'redo' | 'skip') => void
  stop: () => Promise<{ sessionId: string; videoPath: string; actionLogPath: string }>
}

const INJECTED_LISTENER_SCRIPT = `
(() => {
  function selectorFor(el) {
    if (el.id) return '#' + el.id
    if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]'
    return el.tagName.toLowerCase()
  }

  document.addEventListener('click', (event) => {
    const el = event.target
    if (!(el instanceof Element)) return
    window.__demoEditorRecordAction({
      kind: 'click',
      selector: selectorFor(el),
      text: (el.textContent || '').trim().slice(0, 100)
    })
  }, true)

  document.addEventListener('change', (event) => {
    const el = event.target
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return
    window.__demoEditorRecordAction({
      kind: 'input',
      selector: selectorFor(el),
      value: el.value,
      inputType: 'type' in el ? el.type : 'text'
    })
  }, true)
})()
`

function normalizeUrl(url: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
}

export async function startRecordingSession(
  projectId: string,
  url: string,
  baseDir: string = homedir()
): Promise<RecordingSession> {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${projectId}`)
  }

  const sessionId = randomUUID()
  const sessionDir = join(dir, 'sources', `session-${sessionId}`)
  mkdirSync(sessionDir, { recursive: true })
  const actionLogPath = join(sessionDir, 'actions.jsonl')

  let browser: Browser | undefined
  try {
    browser = await chromium.launch({ headless: false })
    const context: BrowserContext = await browser.newContext({
      recordVideo: { dir: sessionDir, size: { width: 1280, height: 720 } }
    })

    await context.exposeFunction('__demoEditorRecordAction', (data: Record<string, unknown>) => {
      const isRedactedInput = data.kind === 'input' && shouldRedactInputValue((data.inputType as string) ?? '')
      const entry: ActionLogEntry = {
        t: Date.now() - startTime,
        type: data.kind as ActionLogEntry['type'],
        selector: data.selector as string | undefined,
        text: data.text as string | undefined,
        value: isRedactedInput ? '[redacted]' : (data.value as string | undefined)
      }
      appendActionLogEntry(actionLogPath, entry)
    })

    await context.addInitScript(INJECTED_LISTENER_SCRIPT)

    const page: Page = await context.newPage()
    // Frame 0 of the recording is written here, when the page is created — not at
    // browser launch. Anchoring startTime here keeps action-log timestamps aligned
    // with the video's own frame timeline, which clip-cutting will depend on later.
    const startTime = Date.now()

    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return
      appendActionLogEntry(actionLogPath, { t: Date.now() - startTime, type: 'navigation', url: frame.url() })
    })

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      appendActionLogEntry(actionLogPath, { t: Date.now() - startTime, type: 'console.error', text: msg.text() })
    })

    await page.goto(normalizeUrl(url))

    function markAnnotation(annotation: 'important' | 'redo' | 'skip'): void {
      appendActionLogEntry(actionLogPath, { t: Date.now() - startTime, type: 'annotation', annotation })
    }

    async function stop(): Promise<{ sessionId: string; videoPath: string; actionLogPath: string }> {
      const video = page.video()
      await context.close()
      await browser?.close()

      const videoPath = join(sessionDir, 'video.webm')
      if (video) {
        const actualPath = await video.path()
        if (actualPath !== videoPath) {
          renameSync(actualPath, videoPath)
        }
      }

      return { sessionId, videoPath, actionLogPath }
    }

    return { sessionId, projectId, page, markAnnotation, stop }
  } catch (err) {
    if (browser) {
      await browser.close()
    }
    rmSync(sessionDir, { recursive: true, force: true })
    throw err
  }
}
