import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'http'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AddressInfo } from 'net'
import type { Page } from 'playwright'
import { createProject } from '../project/projectApi'
import { startRecordingSession, type RecordingSession } from './recordSession'
import { exploreApp, readPage, type ExploreResult } from './exploreSession'
import { authWall } from './authWall'

/**
 * Whether the walk carries on with the app once the person has signed in.
 *
 * Its sister file signInRecording.test.ts asks the same question of the video — what footage
 * survives a sign-in — and the two are separate because they broke separately. A recording can
 * keep every frame of a demo the walk was not driving, and a walk can be reading a page the
 * recording stopped showing minutes ago. Both look identical to whoever asked to be shown round:
 * the video ends at a login screen.
 *
 * Everything here is end to end against a real browser and a real sign-in, because the failures
 * were all in the joins. Signing in is the one moment in a demo when the page being looked at
 * can stop being the page the walk started on, and nothing inside either piece can see that.
 *
 * The app is served over HTTP rather than from files. Chromium gives every file:// page its own
 * opaque origin, so `window.opener` is unreachable between them and the commonest sign-in of all
 * — a provider window handing a token back to the tab that opened it — cannot be written down at
 * all. An earlier attempt to test this from files measured that restriction instead of the app.
 */

const DASHBOARD = `<h1>Dashboard</h1><nav><a href="/watchlist">Watchlist</a></nav>`

/** A sign-in the walk can never get through: it never types, and it never submits. */
const CREDENTIALS = `<input id="email" type="email" name="email" placeholder="Email">
  <input id="password" type="password" autocomplete="current-password" placeholder="Password">`

const PAGES: Record<string, string> = {
  /** A login offering both a form and a provider, which is what most apps look like. */
  '/opener': `<!doctype html><title>Acme — Sign in</title><h1>Sign in</h1>${CREDENTIALS}
    <button id="provider" onclick="window.open('/provider','_blank','width=600,height=700')">Continue with Acme</button>
    <script>window.__signedIn = () => {
      document.title = 'Acme'
      document.body.innerHTML = ${JSON.stringify(DASHBOARD)}
    }</script>`,

  /** The provider hands the token back and closes itself, leaving the tab underneath in front. */
  '/provider': `<!doctype html><title>Acme ID</title><h1>Sign in to continue</h1>
    <form>${CREDENTIALS}<button id="go" type="submit">Sign in</button></form>
    <script>document.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault()
      window.opener.__signedIn()
      window.close()
    })</script>`,

  /** The same login, for the provider that keeps the person where it put them. */
  '/handover': `<!doctype html><title>Acme — Sign in</title><h1>Sign in</h1>${CREDENTIALS}
    <button id="provider" onclick="window.open('/provider-stays','_blank','width=1000,height=760')">Continue with Acme</button>`,

  /** This one does not close: the app it signs into is drawn in the window it opened. */
  '/provider-stays': `<!doctype html><title>Acme ID</title><h1>Sign in to continue</h1>
    <form>${CREDENTIALS}<button id="go" type="submit">Sign in</button></form>
    <script>document.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault()
      document.title = 'Acme'
      document.body.innerHTML = ${JSON.stringify(DASHBOARD)}
    })</script>`,

  /** A wall with no form at all — the provider button is the only way in. */
  '/provider-only': `<!doctype html><title>Acme — Sign in</title><h1>Sign in</h1>
    <input id="email" type="email" name="email" placeholder="Email">
    <button id="provider">Continue with Acme</button>
    <a href="/signup">Create an account</a>
    <script>window.__signedIn = () => {
      document.title = 'Acme'
      document.body.innerHTML = ${JSON.stringify(DASHBOARD)}
    }</script>`,

  '/watchlist': `<!doctype html><title>Watchlist</title><h1>Watchlist</h1><nav><a href="/reports">Reports</a></nav>`,
  '/reports': `<!doctype html><title>Reports</title><h1>Reports</h1>`
}

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((request, response) => {
    const page = PAGES[(request.url ?? '').split('?')[0]]
    response.writeHead(page ? 200 : 404, { 'content-type': 'text/html' })
    response.end(page ?? '<!doctype html><title>Gone</title><h1>Not found</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

/**
 * Start a recording on `path`, walk it, and have the person sign in while the walk holds.
 *
 * The sign-in runs alongside the walk rather than before it, because that is the order it
 * happens in and the order is the whole point: the walk has to be sitting at the wall, deciding
 * every second and a half whether it is still there, when the page changes underneath it.
 */
async function walkThroughSignIn(
  path: string,
  signIn: (session: RecordingSession) => Promise<void>,
  decisions: string[] = ['CLICK 1', 'DONE']
): Promise<{ result: ExploreResult; asked: string[] }> {
  const baseDir = mkdtempSync(join(tmpdir(), 'talkie-signin-resume-'))
  const project = createProject('Sign in', baseDir)
  const session = await startRecordingSession(project.id, `${base}${path}`, baseDir)

  const asked: string[] = []
  let n = 0
  const walking = exploreApp(
    // What the recording thinks is on screen, which is what the app itself passes in.
    session.watchedPage,
    project.id,
    {
      maxSteps: 6,
      dwellMs: 200,
      decide: async (prompt) => {
        asked.push(prompt)
        return decisions[n++] ?? 'DONE'
      }
    },
    baseDir
  )

  await signIn(session)
  const result = await walking

  await session.stop()
  rmSync(baseDir, { recursive: true, force: true })
  return { result, asked }
}

/** The window a click opened, once it has finished loading. */
async function windowOpenedBy(session: RecordingSession, selector: string): Promise<Page> {
  const context = session.page.context()
  const [opened] = await Promise.all([
    context.waitForEvent('page'),
    session.page.click(selector)
  ])
  await opened.waitForLoadState()
  return opened
}

async function enterCredentials(page: Page): Promise<void> {
  await page.fill('#email', 'someone@acme.test')
  await page.fill('#password', 'hunter2')
  await page.click('#go')
}

describe('a sign-in that finishes in the window the app opened', () => {
  it('carries on with that window, rather than the login it was opened from', async () => {
    // The shape that was broken. A provider that does not close itself leaves the app it signed
    // into in the window it opened; nothing ever brings the original tab back, and nothing
    // should — the person is looking at the window. The walk was pinned to the page the
    // recording started on, so it went on reading a login screen that was no longer in front of
    // anyone, held there for its full five minutes, and reported an app nobody had signed in to.
    const { result } = await walkThroughSignIn('/handover', async (session) => {
      const window = await windowOpenedBy(session, '#provider')
      await enterCredentials(window)
    })

    expect(result.visited).toEqual(['Watchlist'])
    expect(result.ending).toBe('done')
  }, 120_000)
})

describe('a sign-in that hands back to the tab it was opened from', () => {
  it('carries on with the app that redrew itself underneath', async () => {
    // The other provider shape, and the one the recording was fixed for: the window closes and
    // the app redraws in place with the token it was handed. There is no navigation to announce
    // it and the tab was never hidden, so the only thing that knows the page changed is the
    // recording session, which is why the walk asks it.
    const { result } = await walkThroughSignIn('/opener', async (session) => {
      const window = await windowOpenedBy(session, '#provider')
      await enterCredentials(window)
    })

    expect(result.visited).toEqual(['Watchlist'])
    expect(result.ending).toBe('done')
  }, 120_000)
})

describe('a sign-in screen whose only way in is a provider', () => {
  it('is recognised as a wall, though there is a button on it', async () => {
    // A page asking for an email with a "Continue with Acme" button beside it had a candidate on
    // it, and a wall was only ever declared where there was nowhere at all to go. So this was
    // never a wall, nobody was ever waited for, and the walk clicked the button — landing in a
    // provider window it cannot type into, with the recording still pointed at the login.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-signin-provider-only-'))
    const project = createProject('Provider', baseDir)
    const session = await startRecordingSession(project.id, `${base}/provider-only`, baseDir)

    const reading = await readPage(session.page)

    expect(authWall(reading)?.kind).toBe('sign-in')
    // Because neither of the two things on the page goes anywhere but further into signing in.
    expect(reading.candidates).toEqual([])

    await session.stop()
    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)

  it('waits at it rather than asking which way to go from a login screen', async () => {
    // What the walk never does is the assertion. Every prompt it sends describes a screen it is
    // choosing a move from, so a prompt naming the sign-in is the walk having decided a login
    // was the app — and the click that follows is the one that strands it.
    const { result, asked } = await walkThroughSignIn('/provider-only', async (session) => {
      await session.page.waitForTimeout(2000)
      await session.page.evaluate(() => (window as unknown as { __signedIn: () => void }).__signedIn())
    })

    expect(asked.every((prompt) => !prompt.includes('Continue with Acme'))).toBe(true)
    expect(result.visited).toEqual(['Watchlist'])
  }, 120_000)
})
