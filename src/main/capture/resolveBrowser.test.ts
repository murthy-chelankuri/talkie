import { describe, expect, it } from 'vitest'
import { existsSync } from 'fs'
import { findInstalledBrowser, hasBundledChromium, resolveBrowser, NO_BROWSER_MESSAGE } from './resolveBrowser'

describe('choosing a browser to record in', () => {
  it('prefers a browser the user already has over a 359MB download', () => {
    const installed = findInstalledBrowser()
    if (!installed) return

    expect(resolveBrowser()).toEqual(installed)
    expect(installed.channel).toMatch(/^(chrome|msedge)$/)
  })

  it('names the browser it picked, so the app can say what it is using', () => {
    const choice = resolveBrowser()
    if (!choice) return

    expect(choice.label.trim().length).toBeGreaterThan(0)
  })

  it('only claims an installed browser that is really on disk', () => {
    const installed = findInstalledBrowser()
    if (!installed) return

    const appPath =
      installed.channel === 'chrome' ? '/Applications/Google Chrome.app' : '/Applications/Microsoft Edge.app'
    expect(existsSync(appPath)).toBe(true)
  })

  it('falls back to Playwright\'s own Chromium without throwing when none is installed', () => {
    // hasBundledChromium throws inside playwright when nothing is downloaded; it must not escape.
    expect(() => hasBundledChromium()).not.toThrow()
  })

  it('finds some way to record on this machine', () => {
    expect(resolveBrowser()).not.toBeNull()
  })

  it('tells the user what to do when there is no browser at all', () => {
    expect(NO_BROWSER_MESSAGE).toContain('Chrome')
    expect(NO_BROWSER_MESSAGE).toContain('playwright install')
  })
})
