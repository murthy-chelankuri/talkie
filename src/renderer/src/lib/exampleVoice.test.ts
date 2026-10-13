import { describe, expect, it } from 'vitest'
import { exampleVoiceNote } from './exampleVoice'

describe('the note on an example voiced in Kokoro', () => {
  it('points someone speaking in another engine to Kokoro', () => {
    expect(exampleVoiceNote({ example: 'meet-talkie', engine: 'system', otherVoiceClips: 6 })).toMatch(/Settings → AI/)
  })

  it('says nothing once they speak with Kokoro', () => {
    expect(exampleVoiceNote({ example: 'meet-talkie', engine: 'kokoro', otherVoiceClips: 6 })).toBeNull()
  })

  it('says nothing once every clip is in their own voice', () => {
    expect(exampleVoiceNote({ example: 'meet-talkie', engine: 'system', otherVoiceClips: 0 })).toBeNull()
  })

  it('says nothing about a project of their own', () => {
    expect(exampleVoiceNote({ example: undefined, engine: 'system', otherVoiceClips: 6 })).toBeNull()
  })
})
