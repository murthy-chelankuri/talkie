import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { _electron, type ElectronApplication, type Locator, type Page } from 'playwright'

/**
 * Filming Talkie being used, for the tour in Meet Talkie.
 *
 * The real app, built, driven through its own window the way the end-to-end run drives it — so
 * what the tour shows is what a person gets, and a button that has stopped working stops the
 * build rather than appearing to work in a staged picture. Playwright records each window; the
 * pointer is drawn into the page, because a recording has none and a click nobody can see is a
 * step the viewer has to be told about.
 */

export const WIDTH = 1600
export const HEIGHT = 900

/** A stretch of the film worth keeping, and the clicks inside it. */
export type Shot = {
  name: string
  /** Which window's video it is from. */
  window: 'main' | 'toolbar'
  /** Milliseconds from when that window started recording. */
  from: number
  to: number
  clicks: { t: number; x: number; y: number; w: number; h: number }[]
  /**
   * The part of the frame the window filled, in video pixels, when it is smaller than the frame.
   * Playwright records every window at one size and draws a small one into the corner of it.
   */
  area?: { width: number; height: number }
}

type Window = { page: Page; startedAt: number; name: Shot['window'] }

/**
 * What a filming left: each window's video, and how long its page had been open when the app
 * closed — set against the video's own length, that is how far the page clock runs behind it.
 */
export type Filmed = {
  videos: Partial<Record<Shot['window'], { path: string; pageMs: number }>>
  shots: Shot[]
}

const POINTER_ID = 'talkie-tour-pointer'

/** Drawn into the page rather than the system cursor, which a recording does not see. */
async function addPointer(page: Page): Promise<void> {
  await page.evaluate((id) => {
    if (document.getElementById(id)) return
    const pointer = document.createElement('div')
    pointer.id = id
    pointer.setAttribute('aria-hidden', 'true')
    pointer.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5v17.2l4.6-4.3 3 6.6 3.1-1.4-3-6.5 6.3-.3z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    Object.assign(pointer.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      transform: `translate(${innerWidth * 0.55}px, ${innerHeight * 0.6}px)`,
      transition: 'transform 520ms cubic-bezier(.3,.7,.2,1)',
      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))'
    })
    document.body.appendChild(pointer)
  }, POINTER_ID)
}

export class Film {
  private windows = new Map<Shot['window'], Window>()
  private current: Shot | null = null
  readonly shots: Shot[] = []

  private constructor(
    readonly app: ElectronApplication,
    readonly videoDir: string
  ) {}

  static async start(home: string, videoDir: string, env: Record<string, string> = {}): Promise<Film> {
    mkdirSync(videoDir, { recursive: true })
    const app = await _electron.launch({
      // A profile of its own as well as a home: on macOS Electron finds its user-data folder from
      // the system rather than HOME, so without this the tour shared the person's own window
      // state — and filmed in light mode the day they had chosen it.
      args: ['.', `--user-data-dir=${join(home, 'profile')}`],
      cwd: join(__dirname, '..', '..', '..'),
      env: { ...process.env, ...env, HOME: home },
      recordVideo: { dir: videoDir, size: { width: WIDTH, height: HEIGHT } }
    })
    // Links open in the browser and finished exports are shown in Finder; neither belongs in a
    // build, and both would put windows in front of whoever is at the machine.
    await app.evaluate(({ shell }) => {
      shell.openPath = async () => ''
      shell.showItemInFolder = () => undefined
      shell.openExternal = async () => undefined
    })
    const film = new Film(app, videoDir)
    const page = await app.firstWindow()
    film.windows.set('main', { page, startedAt: Date.now(), name: 'main' })
    const browserWindow = await app.browserWindow(page)
    await browserWindow.evaluate((win, [width, height]) => {
      win.setContentSize(width, height)
      win.center()
    }, [WIDTH, HEIGHT] as const)
    await page.waitForLoadState('domcontentloaded')
    return film
  }

  get win(): Page {
    return this.windows.get('main')!.page
  }

  /** The recording toolbar, once it has opened. */
  async adoptToolbar(page: Page): Promise<void> {
    this.windows.set('toolbar', { page, startedAt: Date.now(), name: 'toolbar' })
    await page.waitForLoadState('domcontentloaded')
  }

  /** Start keeping the film from here, for one step of the tour. */
  async begin(name: string, window: Shot['window'] = 'main'): Promise<void> {
    if (this.current) throw new Error(`"${this.current.name}" is still being filmed`)
    // A filming runs for minutes; this is how anyone watching knows it has not stopped.
    process.stderr.write(`filming: ${name}\n`)
    const { page, startedAt } = this.windows.get(window)!
    await addPointer(page)
    const [width, height, ratio] = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio])
    // Drawn at the screen's pixel density, and only ever scaled down to fit.
    const scale = Math.min(ratio, WIDTH / width, HEIGHT / height)
    const area =
      width < WIDTH || height < HEIGHT ? { width: Math.round(width * scale), height: Math.round(height * scale) } : undefined
    this.current = { name, window, from: Date.now() - startedAt, to: 0, clicks: [], ...(area ? { area } : {}) }
  }

  /** Stop keeping it. What happens until the next `begin` — waiting, mostly — is cut. */
  async end(holdMs = 900): Promise<void> {
    if (!this.current) throw new Error('Nothing is being filmed')
    await this.pause(holdMs)
    const { startedAt } = this.windows.get(this.current.window)!
    this.current.to = Date.now() - startedAt
    this.shots.push(this.current)
    this.current = null
  }

  async shot(name: string, steps: () => Promise<void>, window: Shot['window'] = 'main'): Promise<void> {
    await this.begin(name, window)
    await steps()
    await this.end()
  }

  async pause(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  private pageOf(target: Locator): Window {
    for (const window of this.windows.values()) if (target.page() === window.page) return window
    throw new Error('That control is in a window the film is not watching')
  }

  /** Open one of the editor's side panels, unless it is open already — the tab toggles it. */
  async openPanel(name: string): Promise<void> {
    const tab = this.win.getByRole('tab', { name, exact: true })
    if ((await tab.getAttribute('aria-selected')) !== 'true') await this.click(tab)
  }

  /** Glide the pointer onto something and let it rest there. */
  async pointAt(target: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const { page } = this.pageOf(target)
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    if (!box) throw new Error(`Cannot see ${target.toString()} to point at it`)
    await addPointer(page)
    await page.evaluate(
      ([id, x, y]) => {
        const pointer = document.getElementById(id as string)
        if (pointer) pointer.style.transform = `translate(${x}px, ${y}px)`
      },
      [POINTER_ID, box.x + box.width / 2 - 4, box.y + box.height / 2 - 3] as const
    )
    await this.pause(650)
    return box
  }

  /** Point, then click — and write the click down, so the clip leans in where it landed. */
  async click(target: Locator, { settleMs = 700 }: { settleMs?: number } = {}): Promise<void> {
    const window = this.pageOf(target)
    const box = await this.pointAt(target)
    const viewport = await window.page.evaluate(() => [innerWidth, innerHeight])
    if (this.current && this.current.window === window.name) {
      this.current.clicks.push({
        t: Date.now() - window.startedAt,
        x: (box.x + box.width / 2) / viewport[0],
        y: (box.y + box.height / 2) / viewport[1],
        w: box.width / viewport[0],
        h: box.height / viewport[1]
      })
    }
    await target.click()
    await this.pause(settleMs)
  }

  /** Type into a field a key at a time, at the pace someone would. */
  async type(target: Locator, text: string, { delayMs = 45 }: { delayMs?: number } = {}): Promise<void> {
    await this.click(target, { settleMs: 200 })
    await target.pressSequentially(text, { delay: delayMs })
    await this.pause(400)
  }

  /** Select everything in a field and type over it, as someone replacing a placeholder would. */
  async replace(target: Locator, text: string, { delayMs = 45 }: { delayMs?: number } = {}): Promise<void> {
    await this.click(target, { settleMs: 200 })
    await target.press('Meta+A')
    await this.pause(250)
    await target.pressSequentially(text, { delay: delayMs })
    await this.pause(400)
  }

  /**
   * Close the app and say which video belongs to which window.
   *
   * A window's recording begins a moment before its page reports itself, so every time noted
   * against the page clock is moved by the difference — measured from the end, where the video
   * stops when the window does.
   */
  async finish(): Promise<Filmed> {
    const videos: Filmed['videos'] = {}
    for (const window of this.windows.values()) {
      const path = await window.page.video()?.path().catch(() => '')
      if (path) videos[window.name] = { path, pageMs: 0 }
    }
    const closing = Date.now()
    for (const window of this.windows.values()) {
      const video = videos[window.name]
      if (video) video.pageMs = closing - window.startedAt
    }
    await this.app.close()
    const filmed = { videos, shots: this.shots }
    writeFileSync(join(this.videoDir, 'shots.json'), JSON.stringify(filmed, null, 2))
    return filmed
  }
}
