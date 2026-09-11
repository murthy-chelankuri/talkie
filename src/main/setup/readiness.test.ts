import { describe, expect, it, vi } from 'vitest'

// systemPreferences only exists inside Electron; the check has to work in a plain process too.
vi.mock('electron', () => ({ systemPreferences: { getMediaAccessStatus: () => 'granted' } }))

const { checkReadiness, hasBlockingGap } = await import('./readiness')

describe('readiness', () => {
  it('reports on everything a first run depends on', async () => {
    const ids = (await checkReadiness()).map((check) => check.id).sort()

    expect(ids).toEqual(['decks', 'export', 'microphone', 'recording', 'voice'])
  }, 30_000)

  it('says what each one is for, so a gap reads as a missing feature not an error', async () => {
    for (const check of await checkReadiness()) {
      expect(check.label.trim().length, check.id).toBeGreaterThan(0)
      expect(check.purpose.trim().length, check.id).toBeGreaterThan(0)
    }
  }, 30_000)

  it('tells the user what to do about anything that is not ready', async () => {
    for (const check of await checkReadiness()) {
      if (!check.ready) expect(check.fix?.trim(), `${check.id} gave no way to fix it`).toBeTruthy()
    }
  }, 30_000)

  it('says what it is using for anything that is ready', async () => {
    for (const check of await checkReadiness()) {
      if (check.ready) expect(check.detail?.trim(), `${check.id} did not say what it uses`).toBeTruthy()
    }
  }, 30_000)

  it('treats only the things the app cannot work without as required', async () => {
    const checks = await checkReadiness()
    const optional = checks.filter((check) => !check.required).map((check) => check.id).sort()

    // A deck can be imported as PDF, and narration can be synthesised rather than spoken.
    expect(optional).toEqual(['decks', 'microphone'])
  }, 30_000)

  it('finds nothing essential missing on a machine that can build the app', async () => {
    expect(hasBlockingGap(await checkReadiness())).toBe(false)
  }, 30_000)

  it('spots a blocking gap when one exists', () => {
    expect(
      hasBlockingGap([
        { id: 'recording', label: 'r', purpose: 'p', ready: false, required: true },
        { id: 'decks', label: 'd', purpose: 'p', ready: true, required: false }
      ])
    ).toBe(true)
  })

  it('does not call an optional gap blocking', () => {
    expect(
      hasBlockingGap([{ id: 'decks', label: 'd', purpose: 'p', ready: false, required: false }])
    ).toBe(false)
  })
})
