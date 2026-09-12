import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { highlightScript } from './highlightScript'

/**
 * Run in a real browser, because every interesting failure here is one only a browser has: an
 * event that does not fire, a style a page's own CSS overrules, a content policy that refuses
 * the whole script. A string assertion would pass through all of them.
 */
const PAGE = `<!doctype html><meta charset="utf-8">
<style>button{padding:14px 28px;border-radius:10px}</style>
<button id="go">Search</button>
<input id="q" placeholder="Type here">
<input id="check" type="checkbox">
<p id="prose">Just some words</p>
<div id="huge" style="width:100%;height:100vh;background:#eee">A very large box</div>`

let dir: string
let browser: Browser

function layerCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector('[data-talkie-highlight]')?.children.length ?? 0)
}

async function open(options: Parameters<typeof highlightScript>[0] = {}): Promise<Page> {
  const context = await browser.newContext()
  await context.addInitScript(highlightScript(options))
  const page = await context.newPage()
  await page.goto(`file://${join(dir, 'page.html')}`)
  return page
}

describe('the highlight drawn into a recording', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'talkie-highlight-'))
    writeFileSync(join(dir, 'page.html'), PAGE)
    browser = await chromium.launch({ headless: true })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('draws a ring and a ripple when a button is clicked', async () => {
    const page = await open()

    expect(await layerCount(page)).toBe(0)
    await page.locator('#go').click()

    // The ripple, and the ring around the button itself.
    expect(await layerCount(page)).toBe(2)
    await page.close()
  })

  it('takes the ring away again, rather than leaving it over the page', async () => {
    const page = await open()
    await page.locator('#go').click()

    await page.waitForTimeout(1200)

    expect(await layerCount(page)).toBe(0)
    await page.close()
  })

  it('holds a ring on a field for as long as it is being typed into', async () => {
    const page = await open()
    await page.locator('#q').click()
    await page.locator('#q').type('hello', { delay: 10 })

    // Still there while the words are going in — this one does not flash and vanish.
    expect(await page.locator('[data-talkie-role="focus"]').count()).toBe(1)
    const ringed = await page.evaluate(() => {
      const ring = document.querySelector('[data-talkie-role="focus"]')
      const field = document.querySelector('#q')
      if (!ring || !field) return false
      const a = ring.getBoundingClientRect()
      const b = field.getBoundingClientRect()
      return Math.abs(a.left - b.left) < 6 && Math.abs(a.top - b.top) < 6
    })
    expect(ringed).toBe(true)
    await page.close()
  })

  it('lets the ring go when the field does', async () => {
    const page = await open()
    await page.locator('#q').click()
    await page.locator('#q').blur()
    await page.waitForTimeout(500)

    expect(await page.locator('[data-talkie-role="focus"]').count()).toBe(0)
    await page.close()
  })

  it('rings a checkbox, which is a click rather than something to type into', async () => {
    const page = await open()
    await page.locator('#check').click()

    expect(await layerCount(page)).toBe(2)
    await page.close()
  })

  it('shows only the ripple where there is no control to ring', async () => {
    // Ringing a paragraph says nothing; the pointer still needs to be followable.
    const page = await open()
    await page.locator('#prose').click()

    expect(await layerCount(page)).toBe(1)
    await page.close()
  })

  it('does not draw a border around the whole screen', async () => {
    const page = await open()
    await page.locator('#huge').click()

    expect(await layerCount(page)).toBe(1)
    await page.close()
  })

  it('takes the colour it is given, so a recording can match its subject', async () => {
    const page = await open({ accent: 'rgb(31, 111, 235)' })
    await page.locator('#go').click()

    const colours = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-talkie-highlight] > div')).map(
        (el) => getComputedStyle(el).borderColor
      )
    )
    expect(colours.every((colour) => colour === 'rgb(31, 111, 235)')).toBe(true)
    await page.close()
  })

  it('never becomes the thing that was clicked', async () => {
    // The page has to behave exactly as it would unrecorded, and the action log has to see the
    // button rather than a highlight sitting on top of it.
    const page = await open()
    await page.locator('#go').click()

    const hit = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      return el?.closest('[data-talkie-highlight]') !== null
    })
    expect(hit).toBe(false)
    await page.close()
  })

  it('keeps working after the page navigates', async () => {
    const page = await open()
    await page.reload()
    await page.locator('#go').click()

    expect(await layerCount(page)).toBe(2)
    await page.close()
  })

  it('installs itself once, however many times it is injected', async () => {
    const context = await browser.newContext()
    await context.addInitScript(highlightScript())
    await context.addInitScript(highlightScript())
    const page = await context.newPage()
    await page.goto(`file://${join(dir, 'page.html')}`)

    await page.locator('#go').click()

    // Two rings and two ripples would be one script too many.
    expect(await layerCount(page)).toBe(2)
    await page.close()
  })
})
