import { describe, expect, it } from 'vitest'
import { existsSync } from 'fs'
import { chromium } from 'playwright'
import {
  browserExecutablePath,
  findInstalledBrowser,
  hasBundledChromium,
  headlessShellBeside,
  resolveBrowser,
  NO_BROWSER_MESSAGE
} from './resolveBrowser'

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

describe('choosing a browser to export with', () => {
  it('finds the headless shell Playwright installs beside its Chromium', () => {
    expect(
      headlessShellBeside(
        '/Users/a/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
      )
    ).toBe(
      '/Users/a/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'
    )
  })

  it('does not guess when the path is not one Playwright laid out', () => {
    expect(headlessShellBeside('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')).toBeNull()
  })

  it('renders with the headless shell when there is one, not a full Chrome', () => {
    // A full Chrome made export three times slower; see browserExecutablePath.
    const shell = headlessShellBeside(chromium.executablePath())
    if (!shell || !existsSync(shell)) return
    expect(browserExecutablePath()).toBe(shell)
  })
})
