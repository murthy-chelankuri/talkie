import { existsSync } from 'fs'
import { chromium } from 'playwright'

/**
 * Decide which browser a recording should be made in.
 *
 * Playwright ships its own Chromium, but it is a 359MB download that lives outside the app, so
 * a packaged Talkie that relied on it would install cleanly and then fail the first time anyone
 * pressed Record. A browser the person already has works just as well and costs nothing, so it
 * is tried first, and Playwright's own is the fallback for a machine with neither.
 */
export interface BrowserChoice {
  /** Passed to `chromium.launch` — undefined means Playwright's own build. */
  channel?: 'chrome' | 'msedge'
  /** What to call it when telling the user what is being used. */
  label: string
}

interface InstalledBrowser {
  channel: 'chrome' | 'msedge'
  label: string
  appPath: string
  /** The binary inside the bundle, for things that want a path rather than a channel. */
  executable: string
}

/** Chromium-based browsers Playwright can drive directly, most common first. */
const INSTALLED_BROWSERS: InstalledBrowser[] = [
  {
    channel: 'chrome',
    label: 'Google Chrome',
    appPath: '/Applications/Google Chrome.app',
    executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  },
  {
    channel: 'msedge',
    label: 'Microsoft Edge',
    appPath: '/Applications/Microsoft Edge.app',
    executable: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  }
]

export function findInstalledBrowser(): BrowserChoice | null {
  const found = INSTALLED_BROWSERS.find((browser) => existsSync(browser.appPath))
  return found ? { channel: found.channel, label: found.label } : null
}

/** Whether Playwright's own Chromium has been downloaded on this machine. */
export function hasBundledChromium(): boolean {
  try {
    return existsSync(chromium.executablePath())
  } catch {
    // Throws rather than returning a path when no browser has been installed for this version.
    return false
  }
}

export function resolveBrowser(): BrowserChoice | null {
  return findInstalledBrowser() ?? (hasBundledChromium() ? { label: 'Chromium' } : null)
}

/**
 * A real Chrome opens with its own first-run and session-restore behaviour, which races the
 * navigation the recording starts with — "interrupted by another navigation to about:blank".
 * Playwright's own build has none of that, so these only matter for an installed browser.
 */
export const LAUNCH_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-session-crashed-bubble',
  '--hide-crash-restore-bubble',
  '--disable-features=ChromeWhatsNewUI'
]

/**
 * A browser for Remotion to render with, as a path rather than a channel.
 *
 * Handed over so it never goes looking for one of its own. Left to itself it works out where to
 * download a browser to by walking up from the current directory until it finds a package.json —
 * and an app opened from Finder is started in `/`, where there is none and nothing may be
 * written. Export failed there with `ENOENT: mkdir '/.remotion'`, which names the symptom and
 * nothing else. The same browser that records the demo renders it, which is one fewer thing to
 * install and one fewer thing to differ.
 */
export function browserExecutablePath(): string | null {
  const installed = INSTALLED_BROWSERS.find((browser) => existsSync(browser.executable))
  if (installed) return installed.executable

  try {
    const bundled = chromium.executablePath()
    return existsSync(bundled) ? bundled : null
  } catch {
    return null
  }
}

export const NO_BROWSER_MESSAGE =
  'Recording needs a Chromium-based browser. Install Google Chrome, or run `npx playwright install chromium` to fetch one.'
