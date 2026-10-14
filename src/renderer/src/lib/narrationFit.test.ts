import { describe, expect, it } from 'vitest'
import { estimatedSpokenSeconds, narrationFit, scriptParts, spokenWords, WORDS_PER_SECOND } from './narrationFit'
import { FPS } from '../../../composition/constants'

describe('how long a script takes to say', () => {
  it('counts the words said, not the timings in front of them', () => {
    expect(spokenWords('[0.0] This is Talkie.\n[2.6] It records a session.')).toBe(7)
  })

  it('counts untimed prose as it is', () => {
    expect(spokenWords('One two three.\n\nFour.')).toBe(4)
  })

  it('reads at the voices’ pace', () => {
    expect(estimatedSpokenSeconds('word '.repeat(26))).toBeCloseTo(26 / WORDS_PER_SECOND)
  })
})

describe('whether the words fit the clip', () => {
  const tenSeconds = 10 * FPS

  it('fits a short script in a long clip', () => {
    expect(narrationFit('A few words.', tenSeconds).long).toBe(false)
  })

  it('warns when there is more to say than there is time for', () => {
    expect(narrationFit('word '.repeat(40), tenSeconds).long).toBe(true)
  })

  it('does not count the pauses the timings ask for, since those are shortened to fit', () => {
    // Two words said at the very end of a ten-second clip still fit: placeBeats pulls them in.
    expect(narrationFit('[0.0] Hello.\n[9.9] Goodbye.', tenSeconds).long).toBe(false)
  })

  it('trusts the take over the estimate once there is one', () => {
    const fit = narrationFit('A few words.', tenSeconds, 12.5)
    expect(fit).toEqual({ seconds: 12.5, measured: true, long: true })
  })
})

describe('the script as typed, cut into timings and words', () => {
  it('gives back exactly the text when put together again', () => {
    const script = '[0.0] This is Talkie.\n  [2.6s]  It records.\nand carries on\n'
    expect(scriptParts(script).map((part) => part.text).join('')).toBe(script)
  })

  it('marks only the timing, not the words after it', () => {
    expect(scriptParts('[2.6] It records.')).toEqual([
      { text: '[2.6]', mark: true },
      { text: ' It records.', mark: false }
    ])
  })

  it('leaves a line without a timing as words', () => {
    expect(scriptParts('Just words.')).toEqual([{ text: 'Just words.', mark: false }])
  })
})
