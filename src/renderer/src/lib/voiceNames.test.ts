import { describe, expect, it } from 'vitest'
import { resolveVoiceName } from './voiceNames'
import type { Voice } from '../api/projectClient'

function voice(name: string, locale = 'en_US'): Voice {
  return { name, locale, sample: `Hello! My name is ${name}.`, novelty: false }
}

// What macOS 27 offers: some names qualified by language, some still bare.
const installed = [
  voice('Albert'),
  voice('Samantha (English (US))'),
  voice('Daniel (English (UK))', 'en_GB'),
  voice('Eddy (English (US))'),
  voice('Eddy (German (Germany))', 'de_DE')
]

describe('resolveVoiceName', () => {
  it('leaves a name the machine offers exactly as it is', () => {
    expect(resolveVoiceName('Albert', installed)).toBe('Albert')
    expect(resolveVoiceName('Eddy (German (Germany))', installed)).toBe('Eddy (German (Germany))')
  })

  it('finds the voice a settings file named before macOS started qualifying it', () => {
    expect(resolveVoiceName('Samantha', installed)).toBe('Samantha (English (US))')
    expect(resolveVoiceName('Daniel', installed)).toBe('Daniel (English (UK))')
  })

  it('does not mistake a longer name for a qualified one', () => {
    expect(resolveVoiceName('Dan', installed)).toBe('Dan')
    expect(resolveVoiceName('Al', installed)).toBe('Al')
  })

  it('keeps a voice that is no longer installed, rather than silently choosing another', () => {
    expect(resolveVoiceName('Victoria', installed)).toBe('Victoria')
  })

  it('leaves "follows the app default" alone', () => {
    expect(resolveVoiceName('', installed)).toBe('')
  })
})
