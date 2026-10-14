import { describe, expect, it } from 'vitest'
import { revealFrames, FALLBACK_STAGGER_FRAMES } from './revealOnBeat'
import { NARRATION_LEAD_IN_FRAMES } from './constants'

const FPS = 30
const at = (seconds: number): number => NARRATION_LEAD_IN_FRAMES + seconds * FPS

describe('when a slide shows each of its lines', () => {
  it('waits for the sentence about it', () => {
    // The whole point: a line that appears twenty seconds before it is mentioned has been read
    // and forgotten by the time the voice gets there.
    const beats = [
      { at: 0, text: 'Here is what it does.' },
      { at: 4, text: 'It tracks eight names.' },
      { at: 9, text: 'It grades every call.' }
    ]

    expect(revealFrames(2, beats, FPS)).toEqual([at(4), at(9)])
  })

  it('gives the opening beat to the title rather than to the first line', () => {
    // A slide is nearly always introduced before its points, so counting from the end is what
    // puts each line with the sentence about it.
    const beats = [
      { at: 0, text: 'Three things matter here.' },
      { at: 3, text: 'One.' },
      { at: 6, text: 'Two.' },
      { at: 9, text: 'Three.' }
    ]

    expect(revealFrames(3, beats, FPS)).toEqual([at(3), at(6), at(9)])
  })

  it('lines up one to one when every beat is a line', () => {
    const beats = [
      { at: 1, text: 'One.' },
      { at: 5, text: 'Two.' }
    ]

    expect(revealFrames(2, beats, FPS)).toEqual([at(1), at(5)])
  })

  it('falls back to a stagger when the take was never timed', () => {
    // Narration read straight through says nothing about when anything is mentioned, and one
    // line at a time is still better than all at once.
    expect(revealFrames(3, [], FPS)).toEqual([0, FALLBACK_STAGGER_FRAMES, FALLBACK_STAGGER_FRAMES * 2])
  })

  it('shows the last lines together rather than hiding them when beats run short', () => {
    // Fewer moments than lines is a take that does not mention each one. Better that the
    // extras arrive with the last thing said than that they never arrive at all.
    const beats = [{ at: 2, text: 'Only one thing is said.' }]

    expect(revealFrames(3, beats, FPS)).toEqual([at(2), at(2), at(2)])
  })

  it('has nothing to say about a slide with no lines', () => {
    expect(revealFrames(0, [{ at: 1, text: 'x' }], FPS)).toEqual([])
  })
})
