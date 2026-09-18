import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { randomUUID } from 'crypto'
import { mkdirSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { findProjectDir } from '../project/paths'
import { appendActionLogEntry, type ActionLogEntry } from './actionLog'
import { shouldRedactInputValue } from './redact'
import { resolveBrowser, LAUNCH_ARGS, NO_BROWSER_MESSAGE } from './resolveBrowser'
import { HEIGHT, WIDTH } from '../../remotion/constants'
import { highlightScript } from './highlightScript'
import { readSettings } from '../settings/settingsStore'
import type { RecordedClip } from './stitchRecording'

/**
 * The page is laid out at this size and drawn at whatever density makes the export native.
 *
 * Recording at 1280x720 and exporting at 1920x1080 upscaled every captured clip by half again,
 * which is why text in a recording looked soft next to a slide written in the app. Raising the
 * layout to 1920 instead would have fixed the sharpness and shrunk everything on screen — a
 * desktop browser laid out at 1920 puts small text in a 1080p frame. So the layout stays the
 * size of an ordinary browser window and the pixels are drawn at 1.5x, which is what the export
 * wants and what the screen can still fit.
 */
const CAPTURE_CSS_WIDTH = 1280
const CAPTURE_CSS_HEIGHT = 720

/**
 * Shorter than this and a tab was passed through rather than looked at.
 *
 * Switching tabs fires the same event as arriving at one, so a middle-clicked link or a tab
 * closing can put a page on screen for a handful of frames. Cutting to it and away again reads
 * as a glitch. It only applies where there is something else to cut to: a whole recording that
 * short is still the recording the person made, and dropping it would leave them with nothing.
 */
const MIN_CLIP_MS = 350

export interface RecordingResult {
  sessionId: string
  /** Every stretch the person watched, in the order they watched it. */
  clips: RecordedClip[]
  actionLogPath: string
  // How much of the start of the first clip is the blank page before the site loaded.
  contentStartMs: number
}

export interface RecordingSession {
  sessionId: string
  projectId: string
  page: Page
  markAnnotation: (annotation: 'important' | 'redo' | 'skip') => void
  stop: () => Promise<RecordingResult>
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

    // Where it happened, not only what it was. Recorded as a share of the viewport rather than
    // in pixels, so it still means the same thing in a video of a different size — this is what
    // lets the export draw attention to the place a click landed.
    const box = el.getBoundingClientRect()
    const width = window.innerWidth || 1
    const height = window.innerHeight || 1

    window.__demoEditorRecordAction({
      kind: 'click',
      selector: selectorFor(el),
      text: (el.textContent || '').trim().slice(0, 100),
      x: (box.left + box.width / 2) / width,
      y: (box.top + box.height / 2) / height,
      w: box.width / width,
      h: box.height / height
    })
  }, true)

  document.addEventListener('change', (event) => {
    const el = event.target
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return
    window.__demoEditorRecordAction({
      kind: 'input',
      selector: selectorFor(el),
      value: el.value,
      inputType: 'type' in el ? el.type : 'text',
      // Sent so the value can be judged before it is written down: a one-time code and an API
      // key are ordinary text fields, and only these say what the field is really for.
      autocomplete: el.autocomplete || '',
      name: el.name || '',
      fieldId: el.id || ''
    })
  }, true)
})()
`

/**
 * Says when this page is the one on screen.
 *
 * There is no way to ask a browser context which tab is in front, but every page knows when it
 * is shown, and Chromium fires this on a tab switch as well as on a load. Only becoming visible
 * is reported: a page stays the one being watched until another takes over, so a window that is
 * minimised or covered by another application does not end the clip.
 */
const VISIBILITY_SCRIPT = `
(() => {
  const shown = () => { if (!document.hidden) window.__talkiePageShown() }
  document.addEventListener('visibilitychange', shown)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', shown)
  } else {
    shown()
  }
})()
`

/**
 * Whether the recorded browser is hidden.
 *
 * Never in the app: recording means the person drives a real browser and watches what they are
 * demonstrating. The test suite is the other case — it drives every page through Playwright, so
 * a window is no use to anyone and stealing focus from whatever else is being worked on is a
 * real cost. Set by vitest.config.ts rather than by a setting, because a user has no reason to
 * want this and no way to get their recording back if they turn it on by accident.
 */
const HEADLESS = process.env.TALKIE_HEADLESS === '1'

function normalizeUrl(url: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
}

/**
 * Say what to do about a certificate the machine will not accept.
 *
 * Chromium reports these as a net:: code inside a page.goto failure, which tells someone
 * recording their own development build nothing about the setting that would let them.
 */
function describeCertificateFailure(err: unknown): unknown {
  const message = err instanceof Error ? err.message : String(err)
  if (!/ERR_CERT|ERR_SSL|ERR_BAD_SSL/.test(message)) return err

  return new Error(
    'The browser would not open that address because its certificate is not trusted. If this is ' +
      'your own build, turn on "Record sites with untrusted certificates" in Settings → Recording.'
  )
}

/** One stretch of attention: a page, and the window of session time it was on screen for. */
interface WatchedStretch {
  page: Page
  fromMs: number
  toMs?: number
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
    // A browser the user already has, falling back to Playwright's own download.
    const choice = resolveBrowser()
    if (!choice) {
      throw new Error(NO_BROWSER_MESSAGE)
    }
    browser = await chromium.launch({
      // The person is the one driving this browser, so it has to be on screen. The exception is
      // the test suite, which drives it itself and has no one watching — see HEADLESS.
      headless: HEADLESS,
      channel: choice.channel,
      args: choice.channel ? LAUNCH_ARGS : []
    })
    const { recording } = readSettings(baseDir)
    const context: BrowserContext = await browser.newContext({
      // A layout the size of an ordinary desktop browser, drawn at the density the export needs.
      viewport: { width: CAPTURE_CSS_WIDTH, height: CAPTURE_CSS_HEIGHT },
      deviceScaleFactor: WIDTH / CAPTURE_CSS_WIDTH,
      recordVideo: { dir: sessionDir, size: { width: WIDTH, height: HEIGHT } },
      // A build on a development box is usually served with a certificate nothing trusts. See
      // RecordingSettingsSchema for why this is a setting and not simply on.
      ignoreHTTPSErrors: recording.allowUntrustedCertificates
    })

    // Frame 0 of every recording is written when its page is created, so session time is
    // anchored just before the first one. That is what keeps action-log timestamps aligned
    // with the video's own frame timeline, which clip-cutting depends on.
    const startTime = Date.now()
    const now = (): number => Date.now() - startTime

    /** When each page's own video starts, in session time. */
    const openedAt = new Map<Page, number>()
    const watched: WatchedStretch[] = []

    function watch(page: Page): void {
      const current = watched[watched.length - 1]
      if (current && current.toMs === undefined) {
        if (current.page === page) return
        current.toMs = now()
      }
      watched.push({ page, fromMs: now() })
    }

    await context.exposeFunction('__demoEditorRecordAction', (data: Record<string, unknown>) => {
      const isRedactedInput =
        data.kind === 'input' &&
        shouldRedactInputValue({
          type: data.inputType as string | undefined,
          autocomplete: data.autocomplete as string | undefined,
          name: data.name as string | undefined,
          id: data.fieldId as string | undefined
        })
      const entry: ActionLogEntry = {
        t: now(),
        type: data.kind as ActionLogEntry['type'],
        selector: data.selector as string | undefined,
        text: data.text as string | undefined,
        value: isRedactedInput ? '[redacted]' : (data.value as string | undefined),
        ...(typeof data.x === 'number' ? { x: data.x as number, y: data.y as number } : {}),
        ...(typeof data.w === 'number' ? { w: data.w as number, h: data.h as number } : {})
      }
      appendActionLogEntry(actionLogPath, entry)
    })

    // A binding rather than a function, because which page called is the whole point.
    await context.exposeBinding('__talkiePageShown', ({ page }) => watch(page))

    await context.addInitScript(INJECTED_LISTENER_SCRIPT)
    await context.addInitScript(VISIBILITY_SCRIPT)

    // Added as an init script too, so it is in place before the page's own code runs and comes
    // back after every navigation — a highlight that only worked on the first page would be
    // worse than none.
    if (recording.highlight) {
      await context.addInitScript(highlightScript({ accent: recording.highlightColour }))
    }

    // Every page, not only the one the recording started on: a link that opens a tab is an
    // ordinary thing to do in a demo, and what happens in that tab is the demo.
    context.on('page', (opened) => {
      openedAt.set(opened, now())

      opened.on('framenavigated', (frame) => {
        if (frame !== opened.mainFrame()) return
        appendActionLogEntry(actionLogPath, { t: now(), type: 'navigation', url: frame.url() })
      })

      opened.on('console', (msg) => {
        if (msg.type() !== 'error') return
        appendActionLogEntry(actionLogPath, { t: now(), type: 'console.error', text: msg.text() })
      })

      opened.on('close', () => {
        const current = watched[watched.length - 1]
        if (current?.page === opened && current.toMs === undefined) {
          current.toMs = now()
        }
      })
    })

    const page: Page = await context.newPage()
    // The first page is on screen from the moment it exists, and its visibility script cannot
    // report that until something has loaded in it.
    watch(page)

    try {
      await page.goto(normalizeUrl(url))
    } catch (err) {
      throw describeCertificateFailure(err)
    }
    // Recording begins at page creation, so everything up to here is the blank page before the
    // site loaded — a white lead-in baked into the video. Reporting where it ends lets the
    // import trim it instead of playing a white screen between clips.
    const contentStartMs = now()

    function markAnnotation(annotation: 'important' | 'redo' | 'skip'): void {
      appendActionLogEntry(actionLogPath, { t: now(), type: 'annotation', annotation })
    }

    async function stop(): Promise<RecordingResult> {
      const endedAt = now()
      const last = watched[watched.length - 1]
      if (last && last.toMs === undefined) {
        last.toMs = endedAt
      }

      // The videos are only finished once their pages are, so every path is asked for after
      // this and not before.
      const videos = new Map(context.pages().map((open) => [open, open.video()]))
      for (const stretch of watched) {
        if (!videos.has(stretch.page)) videos.set(stretch.page, stretch.page.video())
      }
      await context.close()
      await browser?.close()

      // Named for the order they were opened in, so a session directory reads as what happened.
      const paths = new Map<Page, string>()
      let n = 0
      for (const [watchedPage, video] of videos) {
        if (!video) continue
        n += 1
        const wanted = join(sessionDir, `page-${n}.webm`)
        try {
          const actualPath = await video.path()
          if (actualPath !== wanted) renameSync(actualPath, wanted)
          paths.set(watchedPage, wanted)
        } catch (err) {
          // One page's recording failing to land must not cost the others.
          console.error('Could not keep the recording of one of the pages:', err)
        }
      }

      const clips: RecordedClip[] = []
      for (const stretch of watched) {
        const videoPath = paths.get(stretch.page)
        const durationMs = (stretch.toMs ?? endedAt) - stretch.fromMs
        if (!videoPath) continue
        if (watched.length > 1 && durationMs < MIN_CLIP_MS) continue
        clips.push({
          videoPath,
          trimBeforeMs: Math.max(0, stretch.fromMs - (openedAt.get(stretch.page) ?? 0)),
          durationMs,
          fromSessionMs: stretch.fromMs
        })
      }

      return { sessionId, clips, actionLogPath, contentStartMs }
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
