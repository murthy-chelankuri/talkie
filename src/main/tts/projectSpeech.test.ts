import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { engineOfVoice, projectSpeech } from './engineRegistry'
import { readSettings, updateSettings } from '../settings/settingsStore'
import { DEFAULT_KOKORO_VOICE, SpeechSettingsSchema } from '../settings/schema'

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
  it('reads every voice in Kokoro, the only engine', () => {
    expect(engineOfVoice('af_heart')).toBe('kokoro')
    expect(engineOfVoice('bm_george')).toBe('kokoro')
  })
})

describe('who reads a project', () => {
  it('reads a project in its own voice', () => {
    expect(projectSpeech('bm_george', { engine: 'kokoro', voice: 'af_heart' })).toEqual({ engine: 'kokoro', voice: 'bm_george' })
  })

  it('follows the app, engine and voice, when the project has no voice of its own', () => {
    expect(projectSpeech(undefined, { engine: 'kokoro', voice: 'bf_emma' })).toEqual({ engine: 'kokoro', voice: 'bf_emma' })
    // A blank app voice falls back to Kokoro's default rather than nothing.
    expect(projectSpeech('  ', { engine: 'kokoro', voice: '' })).toEqual({ engine: 'kokoro', voice: DEFAULT_KOKORO_VOICE })
  })
})

describe('the app’s voice', () => {
  it('keeps a Kokoro voice chosen for it', () => {
    const base = home()
    updateSettings({ speech: { engine: 'kokoro', voice: 'af_bella' } }, base)
    expect(readSettings(base).speech).toMatchObject({ engine: 'kokoro', voice: 'af_bella' })
  })

  it('reads a settings file left on the removed `system` engine as Kokoro, with its default voice', () => {
    // A file written before the Mac voices were dropped named `system` and a Mac voice; neither
    // means anything to Kokoro, so both move to Kokoro's own rather than the file being discarded.
    expect(SpeechSettingsSchema.parse({ engine: 'system', voice: 'Daniel' })).toMatchObject({
      engine: 'kokoro',
      voice: DEFAULT_KOKORO_VOICE
    })
  })

  it('replaces a Mac voice name left on Kokoro with Kokoro’s default', () => {
    expect(SpeechSettingsSchema.parse({ engine: 'kokoro', voice: 'af_heart' }).voice).toBe('af_heart')
    expect(SpeechSettingsSchema.parse({ engine: 'kokoro', voice: 'Samantha' }).voice).toBe(DEFAULT_KOKORO_VOICE)
  })
})
