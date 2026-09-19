import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../project/projectApi'
import { startRecordingSession } from './recordSession'
import { exploreApp, readPage, waitForSignIn } from './exploreSession'
import { authWall } from './authWall'

describe('what the recorder sees when it reads a real page', () => {
  it('offers the ways round the app and nothing that acts on it', async () => {
    // The safety rules are only as good as what the page reader hands them, so this is the pair
    // tested together against real markup rather than the predicate on its own.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-explore-'))
    const project = createProject('Explore', baseDir)
    const url = `file://${join(__dirname, 'fixtures', 'explore-test-page.html')}`

    const session = await startRecordingSession(project.id, url, baseDir)
    const reading = await readPage(session.page)
    await session.stop()

    const labels = reading.candidates.map((candidate) => candidate.label)

    // Ways of getting somewhere.
    expect(labels).toContain('Watchlist')
    expect(labels).toContain('Reports')
    expect(labels).toContain('Positions')
    expect(labels).toContain('Settings')

    // Things that act, leave, or take input.
    expect(labels).not.toContain('Delete portfolio')
    expect(labels).not.toContain('Sign out')
    // A submit button inside a form, and the field beside it.
    expect(labels).not.toContain('Search')
    // Somewhere else entirely, and out of the browser altogether.
    expect(labels).not.toContain('Docs')
    expect(labels).not.toContain('Email us')
    // Not on screen, and not usable.
    expect(labels).not.toContain('Hidden page')
    expect(labels).not.toContain('Unavailable')

    // And it can say where it is, which is what the walk is steered by.
    expect(reading.heading).toBe('Dashboard')
    expect(reading.title).toBe('Acme')

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)

  it('hands back selectors that actually click the thing they describe', async () => {
    // Selectors built from class names break on exactly the generated markup worth demoing, so
    // the reader stamps its own attribute — this is the check that it round-trips.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-explore-click-'))
    const project = createProject('Explore Click', baseDir)
    const url = `file://${join(__dirname, 'fixtures', 'explore-test-page.html')}`

    const session = await startRecordingSession(project.id, url, baseDir)
    const reading = await readPage(session.page)
    const watchlist = reading.candidates.find((candidate) => candidate.label === 'Watchlist')

    expect(watchlist).toBeDefined()
    await session.page.click(watchlist!.selector, { timeout: 5000 })
    await session.page.waitForLoadState()
    expect(session.page.url()).toContain('explore-test-watchlist')

    await session.stop()
    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)
})

describe('an app that wants signing in to', () => {
  it('waits for the person instead of deciding the app is finished', async () => {
    // Without this the walk finds nothing safe to click, concludes there is nothing more to
    // show, and leaves a recording of a login screen with no explanation of why.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-explore-login-'))
    const project = createProject('Login', baseDir)
    const url = `file://${join(__dirname, 'fixtures', 'explore-test-login.html')}`

    const session = await startRecordingSession(project.id, url, baseDir)
    const reading = await readPage(session.page)

    const wall = authWall(reading)
    expect(wall?.kind).toBe('sign-in')

    // The person signs in while the recorder holds. The browser is real and on screen, which is
    // the whole reason waiting works.
    const waiting = waitForSignIn(session.page, wall, { waitMs: 20_000 })
    await session.page.fill('#email', 'someone@acme.test')
    await session.page.fill('#password', 'hunter2')
    await session.page.click('button[type=submit]')

    const past = await waiting
    expect(past).not.toBeNull()
    expect(past!.candidates.map((candidate) => candidate.label)).toContain('Watchlist')

    await session.stop()
    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)

  it('gives up rather than holding a recording open for ever', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-explore-login-give-up-'))
    const project = createProject('Login Timeout', baseDir)
    const url = `file://${join(__dirname, 'fixtures', 'explore-test-login.html')}`

    const session = await startRecordingSession(project.id, url, baseDir)
    const reading = await readPage(session.page)

    // Nobody signs in.
    expect(await waitForSignIn(session.page, authWall(reading), { waitMs: 3000 })).toBeNull()

    await session.stop()
    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)
})

describe('walking the app from start to finish', () => {
  async function walk(decisions: string[], options: Record<string, unknown> = {}) {
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-walk-'))
    const project = createProject('Walk', baseDir)
    const url = `file://${join(__dirname, 'fixtures', 'explore-test-page.html')}`
    const session = await startRecordingSession(project.id, url, baseDir)

    const asked: string[] = []
    let n = 0
    const result = await exploreApp(
      session.page,
      project.id,
      {
        maxSteps: 6,
        dwellMs: 50,
        decide: async (prompt) => {
          asked.push(prompt)
          const next = decisions[n++]
          if (next === undefined) return 'DONE'
          if (next.startsWith('THROW')) throw new Error(next.slice(6))
          return next
        },
        ...options
      },
      baseDir
    )

    await session.stop()
    rmSync(baseDir, { recursive: true, force: true })
    return { result, asked }
  }

  it('follows the moves it is given and reports where it went', async () => {
    const { result } = await walk(['CLICK 1', 'DONE'])

    expect(result.ending).toBe('done')
    expect(result.visited).toHaveLength(1)
  }, 60_000)

  it('tells the difference between an app with nothing left and a model it cannot reach', async () => {
    // Reported as "nothing to explore", a provider that is not signed in sends someone looking
    // at their own app instead of at the CLI.
    const { result } = await walk(['THROW claude: command not found'])

    expect(result.ending).toBe('model-failed')
    expect(result.reason).toContain('command not found')
    expect(result.visited).toEqual([])
  }, 60_000)

  it('offers only the safe ways on, so a walk cannot choose a Delete', async () => {
    // The numbered list is the whole of what a move can name — an answer is an index into it,
    // so a control missing from it cannot be reached however the model replies. The screen
    // description above it still mentions the Delete button, and should: it is on the page,
    // and describing the screen inaccurately would be its own problem.
    const { asked } = await walk(['DONE'])
    const options = asked[0].slice(asked[0].indexOf('You can go to one of these:'))

    expect(options).toContain('Watchlist')
    expect(options).not.toContain('Delete portfolio')
    expect(options).not.toContain('Sign out')
    expect(options).not.toContain('Search')
  }, 60_000)

  it('stops the moment the recording does, rather than clicking on past it', async () => {
    let stop = false
    const { result } = await walk(['CLICK 1', 'CLICK 1', 'CLICK 1'], {
      shouldStop: () => {
        const now = stop
        stop = true
        return now
      }
    })

    expect(result.ending).toBe('stopped')
  }, 60_000)

  it('gives up on its own clock rather than walking for ever', async () => {
    const { result } = await walk(['CLICK 1', 'CLICK 1', 'CLICK 1'], { maxSeconds: 0 })

    expect(result.ending).toBe('budget')
  }, 60_000)
})
