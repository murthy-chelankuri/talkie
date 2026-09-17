import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../project/projectApi'
import { startRecordingSession } from './recordSession'
import { readPage } from './exploreSession'

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
