import { writeFileSync } from 'fs'
import { chromium, type Frame, type Page } from 'playwright'
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas'
import { getAssetServer, resolveAssetUrl } from '../render/assetServer'
import { resolveBrowser } from '../capture/resolveBrowser'
import { FPS, HEIGHT, WIDTH } from '../../remotion/constants'
import type { RenderTheme } from '../../remotion/renderTheme'
import { DEFAULT_SCENE_THEMES, type SceneTheme } from '../../htmlScene/protocol'

/**
 * Play a scene in a headless browser the way the video does — the same sandbox, the same messages
 * — and report what its author needs to know before anyone watches it. One function for the
 * app's editor, for posters and for agents over MCP, so they all see the same thing.
 */

export interface CheckFrame {
  atSeconds: number
  png: Buffer
}

export interface CheckResult {
  problems: string[]
  frames: CheckFrame[]
  /** The words on the poster frame, or on the last frame checked. */
  visibleText: string
}

export interface CheckRequest {
  /** The scene's entry page, an absolute path. */
  src: string
  durationFrames: number
  params?: Record<string, unknown>
  theme: SceneTheme
  /** Seconds into the scene at which each line of narration starts. */
  beats?: number[]
  /** Which moments to return. By default the start, each beat, and the end. */
  atSeconds?: number[]
  /** Where to write the poster, the frame 40% of the way in. */
  posterTo?: string
  /** The folder the asset server serves — the projects folder. */
  rootDir: string
}

/** No theme means Talkie's own look, as in the video — see HtmlScene.tsx. */
export function sceneThemeFor(theme: RenderTheme | null, variant: 'brand' | 'light' | 'dark'): SceneTheme {
  if (!theme) return DEFAULT_SCENE_THEMES[variant]
  return { ...theme.variants[variant], fonts: theme.fonts, ...(theme.logo ? { logo: theme.logo.url } : {}) }
}

/**
 * Whether two frames differ by more than the compositor's own noise — an edge anti-aliased a shade
 * differently is not a scene that depends on the order it is drawn in; a shape somewhere else is.
 */
async function differs(a: Buffer, b: Buffer): Promise<boolean> {
  if (a.equals(b)) return false
  const [left, right] = await Promise.all([loadImage(a), loadImage(b)])
  const pixels = (image: Image): Uint8ClampedArray => {
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return context.getImageData(0, 0, image.width, image.height).data
  }
  const [p, q] = [pixels(left), pixels(right)]
  if (p.length !== q.length) return true
  let changed = 0
  for (let i = 0; i < p.length; i += 4) {
    if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 48) changed++
  }
  return changed > (p.length / 4) * 0.001
}

/** Chromium encodes a frame of one colour in a few kilobytes; anything drawn on is far larger. */
const BLANK_FRAME_BYTES = 12_000

export async function checkHtmlScene(request: CheckRequest): Promise<CheckResult> {
  const server = await getAssetServer(request.rootDir)
  const pageUrl = resolveAssetUrl(request.src, request.rootDir, server.url)
  const durationSeconds = request.durationFrames / FPS
  const lastMoment = Math.max(0, durationSeconds - 1 / FPS)
  const beats = request.beats ?? []
  const atSeconds = (request.atSeconds ?? [0, ...beats, lastMoment]).map((s) => Math.min(Math.max(0, s), lastMoment))
  const init = { fps: FPS, durationFrames: request.durationFrames, width: WIDTH, height: HEIGHT, params: request.params ?? {}, theme: request.theme, beats }

  const browser = await chromium.launch({ headless: true, channel: resolveBrowser()?.channel })
  const problems = new Set<string>()
  const errors = new Set<string>()
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
    const load = async (): Promise<void> => {
      await page.goto(`${server.url}/__talkie/host.html`)
      await page.evaluate(([url, init]) => (window as unknown as TalkieHostWindow).talkieHost.load(url, init), [pageUrl, init] as const)
    }
    const shoot = async (seconds: number): Promise<Buffer> => {
      await page.evaluate((frame) => (window as unknown as TalkieHostWindow).talkieHost.seek(frame), Math.round(seconds * FPS))
      return page.screenshot()
    }
    // Errors are kept by the host page, which a reload empties, so they are gathered before each.
    const gather = async (): Promise<void> => {
      for (const error of await page.evaluate(() => (window as unknown as TalkieHostWindow).talkieHost.errors)) errors.add(error)
    }

    const left = (): boolean => {
      const frame = page.frames().find((candidate) => candidate !== page.mainFrame())
      return frame !== undefined && frame.url() !== pageUrl
    }
    const LEFT = 'The scene tried to leave its page, which a scene cannot do — it stays on the page it was given.'

    try {
      await load()
    } catch (err) {
      // One that navigated away before it finished loading never says it is ready.
      problems.add(left() ? LEFT : `The scene did not load: ${(err as Error).message.split('\n')[0]}`)
      return { problems: [...problems], frames: [], visibleText: '' }
    }

    const frames: CheckFrame[] = []
    for (const seconds of atSeconds) frames.push({ atSeconds: seconds, png: await shoot(seconds) })

    // A frame may navigate itself however it is sandboxed; the host's policy refuses anywhere but
    // the asset server, and a scene that tried is one to be told about.
    if (left()) {
      problems.add(LEFT)
      return { problems: [...problems, ...errors], frames, visibleText: '' }
    }

    const audit = await sceneFrame(page).evaluate(auditPage)
    for (const thing of audit.offTheme) {
      problems.add(
        thing.startsWith('text in the font')
          ? `Uses ${thing}, which is not one of the theme's — use var(--talkie-font-heading) or var(--talkie-font-body).`
          : `Uses ${thing}, which is not one of the theme's colours — use var(--talkie-heading), var(--talkie-body), var(--talkie-accent) or var(--talkie-bg).`
      )
    }
    for (const text of audit.overflow) problems.add(`"${text}" runs out of the frame.`)
    if (frames.length > 0 && frames.every((frame) => frame.png.length < BLANK_FRAME_BYTES)) {
      problems.add('Every frame checked is blank — a single colour.')
    }
    let visibleText = audit.text
    await gather()

    // Order: the middle moment drawn cold, against the same moment after the ones before it.
    // Remotion draws frames out of order, so a scene that differs here differs in the video.
    const middle = durationSeconds / 2
    await load()
    const cold = await shoot(middle)
    await gather()
    await load()
    for (let s = 0; s < middle; s += 0.5) await shoot(s)
    if (await differs(cold, await shoot(middle))) {
      problems.add('The middle frame differs depending on the order frames are drawn in — animate by talkie.time, not by counting frames or ticks.')
    }
    await gather()

    if (request.posterTo) {
      await load()
      writeFileSync(request.posterTo, await shoot(durationSeconds * 0.4))
      visibleText = (await sceneFrame(page).evaluate(auditPage)).text
      await gather()
    }

    for (const error of errors) problems.add(error)
    return { problems: [...problems], frames, visibleText }
  } finally {
    await browser.close()
  }
}

interface TalkieHostWindow {
  talkieHost: {
    load(url: string, init: object): Promise<void>
    seek(frame: number): Promise<void>
    errors: string[]
  }
}

function sceneFrame(page: Page): Frame {
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame())
  if (!frame) throw new Error('The scene is not on the page.')
  return frame
}

/**
 * Run inside the scene: colours the theme did not give it, text running out of the frame, and the
 * words on screen. A colour counts only on something visible — text, or a shape big enough to see.
 */
function auditPage(): { offTheme: string[]; overflow: string[]; text: string } {
  const root = getComputedStyle(document.documentElement)
  const allowed = ['--talkie-bg', '--talkie-heading', '--talkie-body', '--talkie-accent'].map((name) =>
    root.getPropertyValue(name).trim().toLowerCase()
  )
  const toHex = (colour: string): string | null => {
    const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(colour)
    if (!match || (match[4] !== undefined && Number(match[4]) === 0)) return null
    return '#' + [match[1], match[2], match[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
  }
  const themed = allowed[0] !== ''
  // The first family of each theme font; code in monospace is the one deliberate exception.
  const firstFamily = (stack: string): string => stack.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase()
  const allowedFonts = ['--talkie-font-heading', '--talkie-font-body'].map((name) => firstFamily(root.getPropertyValue(name)))
  const monospace = /mono|menlo|courier|consolas/i
  const offTheme = new Set<string>()
  const overflow: string[] = []
  for (const element of Array.from(document.body.querySelectorAll('*')) as HTMLElement[]) {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue
    const textNodes = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
    if (textNodes.length > 0) {
      const colour = toHex(style.color)
      if (themed && colour && !allowed.includes(colour)) offTheme.add(`text in ${colour}`)
      const family = firstFamily(style.fontFamily)
      if (themed && allowedFonts[0] && !allowedFonts.includes(family) && !monospace.test(family)) {
        offTheme.add(`text in the font ${family}`)
      }
      // Measured on the text itself: a line that will not wrap runs past its box, not with it.
      const range = document.createRange()
      range.selectNodeContents(element)
      const drawn = range.getBoundingClientRect()
      if (drawn.right > innerWidth + 1 || drawn.bottom > innerHeight + 1 || drawn.left < -1 || drawn.top < -1) {
        overflow.push((element.textContent ?? '').trim().slice(0, 40))
      }
    }
    const fill = toHex(style.backgroundColor)
    if (themed && fill && !allowed.includes(fill) && rect.width * rect.height > 2000) offTheme.add(`a shape in ${fill}`)
  }
  return { offTheme: [...offTheme], overflow, text: document.body.innerText.trim().slice(0, 1200) }
}
