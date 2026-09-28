import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROSODY,
  WHOLE_ARC,
  arcFor,
  pitchArcFor,
  splitClauses,
  splitSentences,
  toSpokenMarkup,
  toSpokenPieces
} from './prosody'

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

describe('splitClauses', () => {
  it('keeps the punctuation with the clause it ends, dropping the space after it', () => {
    expect(splitClauses('Dig in, and the page narrows.')).toEqual(['Dig in,', 'and the page narrows.'])
  })

  it('splits on semicolons, colons and dashes as well as commas', () => {
    expect(splitClauses('First; second: third—fourth.')).toEqual(['First;', 'second:', 'third—fourth.'])
  })

  it('returns the whole sentence as one clause when there is nothing to pause at', () => {
    expect(splitClauses('No pause here.')).toEqual(['No pause here.'])
  })
})

describe('pitchArcFor', () => {
  it('generalises arcFor to a range other than the whole take', () => {
    // A slice of a slice: the same maths arcFor uses, against an arbitrary starting range.
    expect(pitchArcFor(0, 2, { from: 10, to: 0 })).toEqual({ from: 10, to: 5 })
    expect(pitchArcFor(1, 2, { from: 10, to: 0 })).toEqual({ from: 5, to: 0 })
  })

  it('agrees with arcFor when the range is the whole take', () => {
    expect(pitchArcFor(1, 4, WHOLE_ARC)).toEqual(arcFor(1, 4))
  })

  it('hands back the whole range untouched for a single piece', () => {
    const arc = { from: 7, to: -2 }
    expect(pitchArcFor(0, 1, arc)).toEqual(arc)
  })
})

describe('toSpokenPieces', () => {
  it('breaks text into the same clauses toSpokenMarkup would embed pauses between', () => {
    const pieces = toSpokenPieces('Dig in, and the page narrows. It settles from there.')

    expect(pieces.map((piece) => piece.text)).toEqual([
      'Dig in,',
      'and the page narrows.',
      'It settles from there.'
    ])
  })

  it('sizes the gap between pieces by what kind of boundary it is', () => {
    const pieces = toSpokenPieces('Dig in, and the page narrows. It settles from there.')

    // Clause boundary, then sentence boundary, then the take's last piece.
    expect(pieces[0].pauseAfterMs).toBe(DEFAULT_PROSODY.clausePauseMs)
    expect(pieces[1].pauseAfterMs).toBe(DEFAULT_PROSODY.sentencePauseMs)
    expect(pieces[2].pauseAfterMs).toBe(0)
  })

  it('gives every piece its own place in the pitch fall, first highest and last lowest', () => {
    const pieces = toSpokenPieces('One, two, three.')

    expect(pieces[0].arc.from).toBeGreaterThan(pieces[pieces.length - 1].arc.from)
  })

  it('fits within a caller-supplied arc rather than always falling the whole way', () => {
    // As when a beat that is itself one slice of a longer take is split further into clauses.
    const beatArc = { from: 1, to: 0 }
    const pieces = toSpokenPieces('One, two.', DEFAULT_PROSODY, beatArc)

    for (const piece of pieces) {
      expect(piece.arc.from).toBeLessThanOrEqual(beatArc.from)
      expect(piece.arc.to).toBeGreaterThanOrEqual(beatArc.to)
    }
  })

  it('gives back nothing for empty narration, the same as toSpokenMarkup', () => {
    expect(toSpokenPieces('   ')).toEqual([])
  })
})

describe('the pitch fall across a take read a beat at a time', () => {
  it('gives a lone sentence in a beat a place in the fall, not the baseline', () => {
    // A beat is very often a single sentence. Left at the baseline every beat came out at the
    // same pitch, so a four-beat take was four identical flat utterances — which is the one
    // thing that stops narration sounding like a person talking.
    const first = toSpokenMarkup('Here is the watchlist.', DEFAULT_PROSODY, arcFor(0, 4))
    const last = toSpokenMarkup('And that is the analysis.', DEFAULT_PROSODY, arcFor(3, 4))

    expect(first).toContain('[[pbas +3]]')
    expect(last).not.toContain('[[pbas +3]]')
  })

  it('falls across the take rather than resetting every beat', () => {
    const pitches = [0, 1, 2, 3].map((index) => {
      const markup = toSpokenMarkup('One sentence.', DEFAULT_PROSODY, arcFor(index, 4))
      return Number(/\[\[pbas ([+-]?\d+)\]\]/.exec(markup)![1])
    })

    // Each beat starts no higher than the one before it, and the take ends lower than it began.
    expect(pitches).toEqual([...pitches].sort((a, b) => b - a))
    expect(pitches[3]).toBeLessThan(pitches[0])
  })

  it('still hands a take read in one piece the whole fall', () => {
    expect(arcFor(0, 1)).toEqual(WHOLE_ARC)
  })
})
