import { describe, expect, it } from 'vitest'
import { describeFidelity, summariseFidelity, FULL_BAND_RATE } from './voiceFidelity'

describe('summariseFidelity', () => {
  it('says nothing about takes already at full band', () => {
    expect(summariseFidelity([{ sampleRate: 48000, voice: 'nova' }])).toBeNull()
    expect(summariseFidelity([{ sampleRate: FULL_BAND_RATE, voice: 'nova' }])).toBeNull()
  })

  it('says nothing about a project with no takes', () => {
    expect(summariseFidelity([])).toBeNull()
  })

  it('reports the lowest rate, because that is the one setting the ceiling', () => {
    const fidelity = summariseFidelity([
      { sampleRate: 48000, voice: 'nova' },
      { sampleRate: 22050, voice: 'Samantha' },
      { sampleRate: 16000, voice: 'Albert' }
    ])

    expect(fidelity?.lowestRate).toBe(16000)
    expect(fidelity?.takes).toBe(2)
  })

  it('names each compact voice once, however many takes it read', () => {
    const fidelity = summariseFidelity([
      { sampleRate: 22050, voice: 'Samantha' },
      { sampleRate: 22050, voice: 'Samantha' },
      { sampleRate: 22050, voice: 'Daniel' }
    ])

    expect(fidelity?.voices).toEqual(['Daniel', 'Samantha'])
  })

  it('ignores an unreadable take rather than calling it compact', () => {
    expect(summariseFidelity([{ sampleRate: 0, voice: 'Samantha' }])).toBeNull()
  })
})

describe('describeFidelity', () => {
  it('says nothing when there is nothing to say', () => {
    expect(describeFidelity(null)).toBeNull()
  })

  it('keeps the always-visible line short enough for a narrow rail', () => {
    const note = describeFidelity({ lowestRate: 22050, voices: ['Samantha'], takes: 4 })

    expect(note?.summary).toContain('Samantha is a compact voice')
    // Roughly three lines at the size it is set in; a paragraph here drowns the panel.
    expect(note?.summary.length).toBeLessThan(70)
  })

  it('holds the measurement and the errand back until they are asked for', () => {
    const note = describeFidelity({ lowestRate: 22050, voices: ['Samantha'], takes: 4 })

    expect(note?.summary).not.toContain('kHz')
    expect(note?.summary).not.toContain('Manage Voices')
    expect(note?.detail).toContain('22.1 kHz')
    expect(note?.detail).toContain('Manage Voices')
    expect(note?.detail).toContain('re-speak')
  })

  it('reads as a list when several voices are compact', () => {
    const note = describeFidelity({ lowestRate: 22050, voices: ['Daniel', 'Karen', 'Samantha'], takes: 9 })

    expect(note?.summary).toContain('Daniel, Karen and Samantha are compact voices')
  })

  it('falls back to counting takes when no voice was recorded against them', () => {
    const note = describeFidelity({ lowestRate: 22050, voices: [], takes: 1 })

    expect(note?.summary).toContain('1 take here uses a compact voice')
  })
})
