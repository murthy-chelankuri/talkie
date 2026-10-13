import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { chromium, type Browser } from 'playwright'
import { join } from 'path'
import { addTimelineItem, createProject, readTimelineLenient } from '../../project/projectApi'
import { projectsRootDir } from '../../project/paths'
import { browserExecutablePath } from '../../capture/resolveBrowser'
import { closeAssetServer, getAssetServer, resolveTimelineAssetUrls } from '../assetServer'
import { FPS, HEIGHT, WIDTH } from '../../../remotion/constants'
import type { TimelineItem } from '../../../remotion/types'

// The page declares window.talkie for the web project; this one is type-checked as node, so it
// names the two calls it makes rather than importing the page's sources.
type TalkiePage = { load: (input: unknown) => Promise<void>; seek: (frame: number) => Promise<void> }

let baseDir: string
let browser: Browser | null = null
afterEach(async () => {
  await browser?.close()
  browser = null
  await closeAssetServer()
  rmSync(baseDir, { recursive: true, force: true })
})

async function openPage(items: object[]) {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-export-page-'))
  const project = createProject('Page', baseDir)
  for (const item of items) addTimelineItem(project.id, item as never, baseDir)
  const root = projectsRootDir(baseDir)
  const server = await getAssetServer(root)
  const timeline = resolveTimelineAssetUrls(readTimelineLenient(project.id, baseDir) as unknown as TimelineItem[], root, server.url)
  browser = await chromium.launch({ executablePath: browserExecutablePath() ?? undefined, headless: true })
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${server.url}/__talkie/export/index.html`)
  await page.evaluate((input) => (window as unknown as { talkie: TalkiePage }).talkie.load(input), { timeline, theme: null, fps: FPS, width: WIDTH, height: HEIGHT, durationInFrames: 120, reader: 'test-0' })
  return { page, errors }
}

describe('the export page', () => {
  it('draws a slide on Talkie’s own clock, frame by frame, with nothing logged', async () => {
    const { page, errors } = await openPage([{ kind: 'scene', start: 0, duration: 120, data: { title: 'Why teams switch', bullets: ['One', 'Two'] } }])
    await page.evaluate(() => (window as unknown as { talkie: TalkiePage }).talkie.seek(60))
    const text = await page.locator('#root').innerText()

    expect(text).toContain('Why teams switch')
    expect(errors).toEqual([])
  }, 120_000)

  it('mounts a clip only while the frame is inside it', async () => {
    const { page } = await openPage([
      { kind: 'scene', start: 0, duration: 30, data: { title: 'First', bullets: [] } },
      { kind: 'scene', start: 30, duration: 90, data: { title: 'Second', bullets: [] } }
    ])
    await page.evaluate(() => (window as unknown as { talkie: TalkiePage }).talkie.seek(45))

    expect(await page.locator('#root').innerText()).not.toContain('First')
    expect(await page.locator('#root').innerText()).toContain('Second')
  }, 120_000)
})
