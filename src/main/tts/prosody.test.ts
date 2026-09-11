import { describe, expect, it } from 'vitest'
import { toSpokenMarkup, splitSentences, DEFAULT_PROSODY } from './prosody'

describe('toSpokenMarkup', () => {
  it('sets the pace once, at the front', () => {
    expect(toSpokenMarkup('Hello.')).toMatch(/^\[\[rate 170\]\]/)
  })

  it('puts a pause between sentences, where a speaker would stop', () => {
    const markup = toSpokenMarkup('First point. Second point.')

    expect(markup).toContain(`[[slnc ${DEFAULT_PROSODY.sentencePauseMs}]]`)
  })

  it('pauses after a comma rather than before it', () => {
    const markup = toSpokenMarkup('Dig in, and the page narrows.')

    expect(markup).toContain(`,[[slnc ${DEFAULT_PROSODY.clausePauseMs}]]and`)
  })

  it('steps the pitch down sentence by sentence, never back up', () => {
    const steps = [...toSpokenMarkup('One. Two. Three. Four.').matchAll(/\[\[pbas ([+-]\d+)\]\]/g)].map((m) =>
      Number(m[1])
    )

    // pbas moves pitch from where it is, so every step after the first opening lift is downward.
    expect(steps[0]).toBeGreaterThan(0)
    for (const step of steps.slice(1)) expect(step).toBeLessThanOrEqual(0)
  })

  it('lands the last sentence below where the first one started', () => {
    const steps = [...toSpokenMarkup('One. Two. Three.').matchAll(/\[\[pbas ([+-]\d+)\]\]/g)].map((m) =>
      Number(m[1])
    )

    // The steps are relative, so the pitch at the end is their running total.
    const positions = steps.reduce<number[]>((acc, step) => [...acc, (acc.at(-1) ?? 0) + step], [])
    expect(positions.at(-1)).toBeLessThan(positions[0])
  })

  it('leaves a single sentence at the voice\'s own pitch', () => {
    expect(toSpokenMarkup('Just the one.')).toContain('[[pbas +0]]')
  })

  it('never lets narration text become a command', () => {
    // Text from a model or a person could contain the brackets say executes.
    const markup = toSpokenMarkup('Say [[slnc 9000]] out loud.')

    expect(markup).not.toContain('[[slnc 9000]]')
    expect(markup).toContain('[ [slnc 9000] ]')
  })

  it('gives back nothing for empty narration', () => {
    expect(toSpokenMarkup('   ')).toBe('')
  })

  it('respects a pace the user has changed', () => {
    expect(toSpokenMarkup('Hello.', { ...DEFAULT_PROSODY, pace: 140 })).toMatch(/^\[\[rate 140\]\]/)
  })
})

describe('splitSentences', () => {
  it('keeps the punctuation with the sentence it ends', () => {
    expect(splitSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?'])
  })

  it('does not split a decimal or an abbreviation mid-number', () => {
    expect(splitSentences('It costs 9.99 today.')).toEqual(['It costs 9.99 today.'])
  })

  it('handles narration with no terminator at all', () => {
    expect(splitSentences('no full stop here')).toEqual(['no full stop here'])
  })
})
