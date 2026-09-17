import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildMovePrompt, exploreApp, parseMove, type PageReading } from './exploreSession'
import { createProject } from '../project/projectApi'
import type { Candidate } from './safeToClick'

function reading(labels: string[]): PageReading {
  const candidates: Candidate[] = labels.map((label, index) => ({
    selector: `[data-talkie-candidate="c${index}"]`,
    label,
    tag: 'a',
    href: `/${label.toLowerCase()}`
  }))
  return {
    url: 'https://app.test/',
    origin: 'https://app.test',
    title: 'Acme',
    heading: 'Dashboard',
    text: 'Your portfolio is up 3% today.',
    fields: [],
    candidates
  }
}

describe('deciding where the recorder goes next', () => {
  it('takes the number the model picked', () => {
    expect(parseMove('CLICK 2', 3)).toEqual({ kind: 'click', index: 1 })
  })

  it('finds the answer after a model that explained itself first', () => {
    const answer = 'The watchlist is the main thing this app does, so I will open it.\nCLICK 3'

    expect(parseMove(answer, 4)).toEqual({ kind: 'click', index: 2 })
  })

  it('stops rather than guessing when the answer cannot be read', () => {
    // A wrong click here is a real action against a real app, so the safe reading of nonsense
    // is to stop walking, not to pick something.
    expect(parseMove('I am not sure what to do here.', 5)).toEqual({ kind: 'done' })
    expect(parseMove('', 5)).toEqual({ kind: 'done' })
  })

  it('ignores a number that is not on the page', () => {
    // A model that invents an option would otherwise have the index land on something else.
    expect(parseMove('CLICK 9', 3)).toEqual({ kind: 'done' })
    expect(parseMove('CLICK 0', 3)).toEqual({ kind: 'done' })
  })

  it('understands scrolling and finishing', () => {
    expect(parseMove('SCROLL', 3)).toEqual({ kind: 'scroll' })
    expect(parseMove('DONE', 3)).toEqual({ kind: 'done' })
  })

  it('takes the last move when a model changes its mind mid-answer', () => {
    expect(parseMove('CLICK 1\nActually, that is already shown.\nDONE', 3)).toEqual({ kind: 'done' })
  })
})

describe('what the recorder is told about a page', () => {
  it('offers the options as numbers it can answer with', () => {
    const prompt = buildMovePrompt(reading(['Watchlist', 'Reports']), [], {
      stepsLeft: 10,
      projectName: 'Acme'
    })

    expect(prompt).toContain('1. Watchlist')
    expect(prompt).toContain('2. Reports')
    expect(prompt).toContain('CLICK <number>')
  })

  it('says what has already been shown, so the walk goes somewhere new', () => {
    // Without this the model re-opens the most obvious thing on every page and the recording is
    // the same screen over and over.
    const prompt = buildMovePrompt(reading(['Watchlist']), ['Overview', 'Reports'], {
      stepsLeft: 5,
      projectName: 'Acme'
    })

    expect(prompt).toContain('Overview → Reports')
  })

  it('says how much room is left, so it can land the demo rather than be cut off', () => {
    const prompt = buildMovePrompt(reading(['Watchlist']), [], { stepsLeft: 3, projectName: 'Acme' })

    expect(prompt).toContain('3 steps left')
  })

  it('passes on what the project says about itself', () => {
    const prompt = buildMovePrompt(reading(['Watchlist']), [], {
      stepsLeft: 9,
      projectName: 'Acme',
      context: 'Who is watching: finance teams'
    })

    expect(prompt).toContain('finance teams')
  })

  it('describes the screen it is on, not just its options', () => {
    const prompt = buildMovePrompt(reading(['Watchlist']), [], { stepsLeft: 9, projectName: 'Acme' })

    expect(prompt).toContain('Dashboard')
    expect(prompt).toContain('up 3% today')
  })
})

describe('asking to be shown round with nothing to ask', () => {
  it('says the project needs a model rather than quietly doing nothing', async () => {
    // The built-in provider writes narration from a template and has no model behind it. A walk
    // that silently produced a recording of one page would look like the feature being broken.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-explore-noprovider-'))
    const project = createProject('No model', baseDir)

    await expect(
      exploreApp({} as never, project.id, {}, baseDir)
    ).rejects.toThrow(/no model behind it/i)

    rmSync(baseDir, { recursive: true, force: true })
  })
})
