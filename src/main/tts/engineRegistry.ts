import type { SpeechEngineId } from '../settings/schema'
import type { TTSProvider } from './ttsProvider'
import { sayTtsProvider } from './sayTtsProvider'
import { openAiTtsProvider } from './openAiTtsProvider'

export const SPEECH_ENGINES: Record<SpeechEngineId, TTSProvider> = {
  system: sayTtsProvider,
  openai: openAiTtsProvider
}

/** Falls back to the one that needs no account, so a bad setting never leaves narration mute. */
export function speechEngine(id: SpeechEngineId): TTSProvider {
  return SPEECH_ENGINES[id] ?? sayTtsProvider
}

export interface SpeechEngineDescription {
  id: SpeechEngineId
  label: string
  available: boolean
  reason?: string
}

export async function describeSpeechEngines(): Promise<SpeechEngineDescription[]> {
  return Promise.all(
    Object.values(SPEECH_ENGINES).map(async (engine) => {
      const { available, reason } = await engine
        .isAvailable()
        .catch(() => ({ available: false, reason: 'This engine could not be reached.' }))
      return { id: engine.id as SpeechEngineId, label: engine.label, available, reason }
    })
  )
}
