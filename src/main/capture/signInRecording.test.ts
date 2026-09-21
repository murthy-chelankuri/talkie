import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'http'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AddressInfo } from 'net'
import { createProject } from '../project/projectApi'
import { startRecordingSession } from './recordSession'
import type { RecordedClip } from './stitchRecording'

/**
 * What survives a sign-in.
 *
 * Every shape here has cost a recording at least once. The session used to end at the moment the
 * person got through the login, and because the browser carried on regardless, the demo they
 * then gave was written to a file that no clip ever pointed at — footage on disk, nothing in the
 * editor, and no error anywhere to say so.
 *
 * The shapes differ in one thing only: what, if anything, tells Talkie the page is being looked
 * at again. A stretch opens when a page reports itself shown, and that has two triggers — the
 * init script running on a navigation, and visibilitychange. A sign-in can arrive with either,
 * both, or neither, and the one that arrives with neither is the one that broke.
 *
 * They are deliberately end to end. The logic that decides what is being watched lives inside
 * the recording session's own closure, which is the right place for it, and every attempt to
 * check it from the outside has measured something other than what is kept.
 */
const TICKER = `<script>
  let n = 0
  setInterval(() => { document.body.firstElementChild.textContent = String(++n) }, 100)
</script>`

/** Long enough to be unmistakable in a clip, short enough to keep the suite honest. */
const BEFORE_MS = 1200
const AFTER_MS = 3000

function body(label: string, extra = '', background = '#fff'): string {
  return `<!doctype html><body style="margin:0;font:48px sans-serif;background:${background}">
    <div>${label}</div>${extra}${TICKER}</body>`
}

const PASSWORD_FIELD = '<input id="p" type="password" autocomplete="current-password">'

/** Milliseconds of recording kept from after the sign-in, which is the whole question. */
function keptAfterSignIn(clips: RecordedClip[], signedInAtMs: number): number {
  return clips
    .filter((clip) => clip.fromSessionMs > signedInAtMs)
    .reduce((total, clip) => total + clip.durationMs, 0)
}

function workspace(name: string): { baseDir: string; projectId: string } {
  const baseDir = mkdtempSync(join(tmpdir(), `talkie-signin-${name}-`))
  return { baseDir, projectId: createProject(name, baseDir).id }
}

describe('a sign-in that happens in the same tab', () => {
  it('keeps the app the person landed on after the password went in', async () => {
    const { baseDir, projectId } = workspace('same-tab')
    writeFileSync(join(baseDir, 'app.html'), body('signed in', '', '#0b0'))
    writeFileSync(
      join(baseDir, 'login.html'),
      body(
        'sign in',
        `<form id="f"><input id="u" name="username" autocomplete="username">${PASSWORD_FIELD}
         <button id="go" type="submit">Log in</button></form>
         <script>document.getElementById('f').addEventListener('submit', (e) => {
           e.preventDefault(); location.href = 'app.html'
         })</script>`
      )
    )

    const session = await startRecordingSession(projectId, `file://${join(baseDir, 'login.html')}`, baseDir)
    await session.page.waitForTimeout(BEFORE_MS)

    await session.page.fill('#u', 'someone@example.com')
    await session.page.fill('#p', 'hunter2')
    await session.page.click('#go')
    await session.page.waitForURL(/app\.html/)
    await session.page.waitForTimeout(AFTER_MS)

    const { clips } = await session.stop()

    // One page throughout, so one stretch covering the whole session rather than a cut at the
    // login: the navigation does not change which page is being watched.
    expect(clips).toHaveLength(1)
    expect(clips[0].durationMs).toBeGreaterThan(BEFORE_MS + AFTER_MS - 500)

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)
})

describe('a sign-in that sends the person to another origin', () => {
  let servers: Server[] = []
  let loginUrl = ''

  beforeAll(async () => {
    // Real sign-ins cross an origin, and crossing one is what would break a script Talkie had
    // injected into the page it started on. Two ports is enough to be two origins.
    const app = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(body('signed in', '', '#0b0'))
    })
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve))
    const appPort = (app.address() as AddressInfo).port

    const login = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(
        body(
          'sign in',
          `<form id="f">${PASSWORD_FIELD}<button id="go" type="submit">Log in</button></form>
           <script>document.getElementById('f').addEventListener('submit', (e) => {
             e.preventDefault(); location.href = 'http://127.0.0.1:${appPort}/'
           })</script>`
        )
      )
    })
    await new Promise<void>((resolve) => login.listen(0, '127.0.0.1', resolve))
    loginUrl = `http://127.0.0.1:${(login.address() as AddressInfo).port}/`

    servers = [app, login]
  })

  afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  })

  it('keeps watching the page across the origin the sign-in lands on', async () => {
    const { baseDir, projectId } = workspace('cross-origin')

    const session = await startRecordingSession(projectId, loginUrl, baseDir)
    await session.page.waitForTimeout(BEFORE_MS)

    await session.page.fill('#p', 'hunter2')
    await session.page.click('#go')
    await session.page.waitForURL(/127\.0\.0\.1/)
    await session.page.waitForTimeout(AFTER_MS)

    const { clips } = await session.stop()

    expect(clips).toHaveLength(1)
    expect(clips[0].durationMs).toBeGreaterThan(BEFORE_MS + AFTER_MS - 500)

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)
})

describe('a sign-in that happens in a window of its own', () => {
  function provider(baseDir: string): string {
    writeFileSync(join(baseDir, 'app.html'), body('signed in', '', '#0b0'))
    writeFileSync(join(baseDir, 'sso.html'), body('provider', PASSWORD_FIELD, '#00b'))
    writeFileSync(
      join(baseDir, 'start.html'),
      body(
        'start',
        `<button id="sso" onclick="window.open('sso.html', '_blank', 'width=600,height=700')">Sign in</button>`
      )
    )
    return `file://${join(baseDir, 'start.html')}`
  }

  async function signIn(session: Awaited<ReturnType<typeof startRecordingSession>>): Promise<void> {
    const context = session.page.context()
    const [window] = await Promise.all([context.waitForEvent('page'), session.page.click('#sso')])
    await window.waitForLoadState()
    await window.bringToFront()
    await window.fill('#p', 'hunter2')
    await window.waitForTimeout(BEFORE_MS)
    // Nothing brings the original tab forward afterwards. The person was already looking at it,
    // so the browser has no reason to say anything changed — which is exactly the problem.
    await window.close()
  }

  it('keeps the app when it redraws in place, with no navigation to announce it', async () => {
    // The regression this file exists for. An app handed a token by a popup redraws itself; it
    // does not navigate, and the tab was never hidden, so neither trigger fires and the last
    // stretch stayed the provider's — ended the moment its window closed.
    const { baseDir, projectId } = workspace('window-redraw')

    const session = await startRecordingSession(projectId, provider(baseDir), baseDir)
    await session.page.waitForTimeout(BEFORE_MS)
    await signIn(session)

    await session.page.evaluate(() => {
      document.body.firstElementChild!.textContent = 'signed in'
      document.body.style.background = '#0b0'
    })
    await session.page.waitForTimeout(AFTER_MS)

    const { clips } = await session.stop()

    expect(keptAfterSignIn(clips, BEFORE_MS * 2)).toBeGreaterThan(AFTER_MS - 500)

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)

  it('keeps the app when the tab underneath navigates instead', async () => {
    // The same shape with the other ending, which always worked: a navigation runs the init
    // script again and that reports the page shown. Kept so the fix for the case above cannot
    // be written in a way that costs this one.
    const { baseDir, projectId } = workspace('window-navigate')

    const session = await startRecordingSession(projectId, provider(baseDir), baseDir)
    await session.page.waitForTimeout(BEFORE_MS)
    await signIn(session)

    await session.page.goto(`file://${join(baseDir, 'app.html')}`)
    await session.page.waitForTimeout(AFTER_MS)

    const { clips } = await session.stop()

    expect(keptAfterSignIn(clips, BEFORE_MS * 2)).toBeGreaterThan(AFTER_MS - 500)

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)
})

describe('a sign-in that happens in a second tab', () => {
  it('keeps the app after the tab it signed in on is closed', async () => {
    // A tab rather than a window, and it fails the same way: closing a tab does not announce
    // the one that becomes active any more than closing a window announces the one underneath.
    // So this was never only about signing in through a provider — any watched page closing
    // while the person carries on somewhere else lost everything after it.
    const { baseDir, projectId } = workspace('second-tab')
    writeFileSync(join(baseDir, 'sso.html'), body('provider', PASSWORD_FIELD, '#00b'))
    writeFileSync(join(baseDir, 'start.html'), body('start'))

    const session = await startRecordingSession(projectId, `file://${join(baseDir, 'start.html')}`, baseDir)
    await session.page.waitForTimeout(BEFORE_MS)

    const context = session.page.context()
    const tab = await context.newPage()
    await tab.goto(`file://${join(baseDir, 'sso.html')}`)
    await tab.bringToFront()
    await tab.fill('#p', 'hunter2')
    await tab.waitForTimeout(BEFORE_MS)
    await tab.close()

    await session.page.waitForTimeout(AFTER_MS)

    const { clips } = await session.stop()

    expect(keptAfterSignIn(clips, BEFORE_MS * 2)).toBeGreaterThan(AFTER_MS - 500)

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)
})
