import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { engineOfVoice, projectSpeech } from './engineRegistry'
import { readSettings, updateSettings } from '../settings/settingsStore'
import { DEFAULT_KOKORO_VOICE, DEFAULT_VOICE, SpeechSettingsSchema } from '../settings/schema'

let homes: string[] = []
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-project-speech-'))
  homes.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of homes) rmSync(dir, { recursive: true, force: true })
  homes = []
})

describe('which engine reads a voice', () => {
  it('knows a Kokoro voice by its name, and every other as one of the Mac’s', () => {
    expect(engineOfVoice('af_heart')).toBe('kokoro')
    expect(engineOfVoice('bm_george')).toBe('kokoro')
    expect(engineOfVoice('Samantha')).toBe('system')
    expect(engineOfVoice('Daniel (English (UK))')).toBe('system')
  })
})

describe('who reads a project', () => {
  it('reads a project in its own voice’s engine, whichever the app is on', () => {
    // The bug: a project kept in af_heart was handed to `say` once the app moved to the Mac's voices.
    expect(projectSpeech('af_heart', { engine: 'system', voice: 'Samantha' })).toEqual({ engine: 'kokoro', voice: 'af_heart' })
    expect(projectSpeech('Daniel', { engine: 'kokoro', voice: 'af_heart' })).toEqual({ engine: 'system', voice: 'Daniel' })
  })

  it('follows the app, engine and voice, when the project has no voice of its own', () => {
    expect(projectSpeech(undefined, { engine: 'kokoro', voice: 'bf_emma' })).toEqual({ engine: 'kokoro', voice: 'bf_emma' })
    expect(projectSpeech('  ', { engine: 'system', voice: '' })).toEqual({ engine: 'system', voice: DEFAULT_VOICE })
  })
})

describe('the app’s voice and its engine', () => {
  it('moves to the Mac’s default voice when the app moves off Kokoro', () => {
    const base = home()
    updateSettings({ speech: { engine: 'kokoro', voice: 'af_bella' } }, base)

    updateSettings({ speech: { engine: 'system' } }, base)

    expect(readSettings(base).speech).toMatchObject({ engine: 'system', voice: DEFAULT_VOICE })
  })

  it('moves to Kokoro’s default voice when the app moves onto it', () => {
    const base = home()
    updateSettings({ speech: { engine: 'system', voice: 'Daniel' } }, base)

    updateSettings({ speech: { engine: 'kokoro' } }, base)

    expect(readSettings(base).speech).toMatchObject({ engine: 'kokoro', voice: DEFAULT_KOKORO_VOICE })
  })

  it('keeps a voice chosen with the engine, and one that already belongs to it', () => {
    expect(SpeechSettingsSchema.parse({ engine: 'kokoro', voice: 'bm_george' }).voice).toBe('bm_george')
    expect(SpeechSettingsSchema.parse({ engine: 'system', voice: 'Daniel' }).voice).toBe('Daniel')
  })

  it('reads a settings file already left with a Kokoro voice on the Mac’s engine as the Mac’s default', () => {
    expect(SpeechSettingsSchema.parse({ engine: 'system', voice: 'af_heart' }).voice).toBe(DEFAULT_VOICE)
  })
})
