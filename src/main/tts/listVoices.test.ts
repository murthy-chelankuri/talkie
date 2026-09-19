import { describe, expect, it } from 'vitest'
import { parseVoiceList, listVoices, isNoveltyVoice } from './listVoices'
import { DEFAULT_VOICE } from '../settings/schema'

// Lines copied verbatim from `say -v '?'` on macOS, including the awkward ones.
const REAL_OUTPUT = [
  'Albert              en_US    # Hello! My name is Albert.',
  'Alice               it_IT    # Ciao! Mi chiamo Alice.',
  'Aman                en_IN    # Hello! My name is Aman.',
  'Amélie              fr_CA    # Bonjour! Je m’appelle Amélie.',
  'Carmit              he_IL    # שלום, שמי כרמית.',
  'Eddy (German (Germany)) de_DE    # Hallo! Ich heiße Eddy.',
  'Eddy (English (US)) en_US    # Hello! My name is Eddy.',
  'Samantha            en_US    # Hello! My name is Samantha.',
  ''
].join('\n')

describe('parseVoiceList', () => {
  it('reads a plain row', () => {
    expect(parseVoiceList(REAL_OUTPUT)).toContainEqual({
      name: 'Samantha',
      locale: 'en_US',
      sample: 'Hello! My name is Samantha.',
      novelty: false
    })
  })

  it('keeps a name that has spaces and nested brackets in it', () => {
    // A single space separates this name from its locale, unlike most rows.
    expect(parseVoiceList(REAL_OUTPUT)).toContainEqual({
      name: 'Eddy (German (Germany))',
      locale: 'de_DE',
      sample: 'Hallo! Ich heiße Eddy.',
      novelty: false
    })
  })

  it('does not confuse two voices that share a first word', () => {
    const names = parseVoiceList(REAL_OUTPUT).map((voice) => voice.name)

    expect(names).toContain('Eddy (German (Germany))')
    expect(names).toContain('Eddy (English (US))')
  })

  it('handles accented names and non-latin samples', () => {
    const voices = parseVoiceList(REAL_OUTPUT)

    expect(voices.find((voice) => voice.name === 'Amélie')?.locale).toBe('fr_CA')
    expect(voices.find((voice) => voice.name === 'Carmit')?.sample).toBe('שלום, שמי כרמית.')
  })

  it('reads every row it was given and no blank ones', () => {
    expect(parseVoiceList(REAL_OUTPUT)).toHaveLength(8)
  })

  it('ignores anything that is not a voice row', () => {
    expect(parseVoiceList('some unrelated output\n\n')).toEqual([])
  })

  it('offers a voice listed twice only once', () => {
    // macOS 27 prints the Siri variant of a voice under the same name and locale, differing only
    // in the sample. `say -v` cannot be told which one is meant, so offering both is a lie.
    const twice = [
      'Samantha (English (US)) en_US    # Hello! My name is Samantha.',
      'Samantha (English (US)) en_US    # Hi, I’m Siri!',
      ''
    ].join('\n')

    expect(parseVoiceList(twice)).toEqual([
      {
        name: 'Samantha (English (US))',
        locale: 'en_US',
        sample: 'Hello! My name is Samantha.',
        novelty: false
      }
    ])
  })

  it('knows which voices are jokes rather than narrators', () => {
    expect(isNoveltyVoice('Zarvox')).toBe(true)
    expect(isNoveltyVoice('Samantha')).toBe(false)
    expect(parseVoiceList(REAL_OUTPUT).find((voice) => voice.name === 'Albert')?.novelty).toBe(true)
  })
})

describe('listVoices (real say)', () => {
  it('finds the voices actually installed on this machine', async () => {
    const voices = await listVoices()

    expect(voices.length).toBeGreaterThan(10)
    // The default ships with every macOS, but macOS 27 qualifies the name — `Samantha` became
    // `Samantha (English (US))` — so it is the base name that has to be there.
    const names = voices.map((voice) => voice.name)
    expect(
      names.some((name) => name === DEFAULT_VOICE || name.startsWith(`${DEFAULT_VOICE} (`))
    ).toBe(true)
    expect(new Set(names).size).toBe(names.length)
    for (const voice of voices) {
      expect(voice.name).not.toMatch(/\s{2,}/)
      expect(voice.locale).toMatch(/^[a-z]{2,3}(_[A-Z]{2})?$/)
    }
  }, 30_000)
})
