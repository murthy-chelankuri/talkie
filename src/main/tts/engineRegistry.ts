import type { SpeechEngineId } from '../settings/schema'
import type { TTSProvider } from './ttsProvider'
import { sayTtsProvider } from './sayTtsProvider'
import { DEFAULT_VOICE } from '../settings/schema'
import { isKokoroVoiceName, kokoroTtsProvider } from './kokoroTtsProvider'
import type { Voice } from './ttsProvider'

export const SPEECH_ENGINES: Record<SpeechEngineId, TTSProvider> = {
  system: sayTtsProvider,
  kokoro: kokoroTtsProvider
}

/** Falls back to the one that needs nothing installed, so a bad setting never leaves narration mute. */
export function speechEngine(id: SpeechEngineId): TTSProvider {
  return SPEECH_ENGINES[id] ?? sayTtsProvider
}

/**
 * The engine a voice is read by. Kokoro's voices are a fixed set of names — `af_heart`, `bm_george`
 * — that no Mac voice shares, so the name is enough to say which.
 */
export function engineOfVoice(voice: string): SpeechEngineId {
  return isKokoroVoiceName(voice) ? 'kokoro' : 'system'
}

/**
 * Who reads a project, and in which voice.
 *
 * A project's own voice brings its engine with it. It used to be a name only, read by whichever
 * engine the app was set to: a project kept in Kokoro's af_heart was handed to the Mac's voices
 * once the app moved to them, spoke in a voice it never chose, and its picker — listing only the
 * engine the app was on — had nothing to move it to. Now a project can be in Kokoro while the app
 * is on the Mac's voices, and the other way round.
 */
export function projectSpeech(
  projectVoice: string | undefined,
  app: { engine: SpeechEngineId; voice: string }
): { engine: SpeechEngineId; voice: string } {
  const own = projectVoice?.trim()
  if (own) return { engine: engineOfVoice(own), voice: own }
  return { engine: app.engine, voice: app.voice.trim() || DEFAULT_VOICE }
}

/**
 * Every voice a project can be read in, from every engine that is ready, each marked with its
 * engine. An engine that is not ready — Kokoro not yet downloaded — offers nothing, since choosing
 * one of its voices would only fail at the first take.
 */
export async function allVoices(): Promise<Voice[]> {
  const lists = await Promise.all(
    Object.entries(SPEECH_ENGINES).map(async ([id, engine]) => {
      const ready = await engine.isAvailable().catch(() => ({ available: false }))
      if (!ready.available) return []
      const voices = await engine.voices().catch(() => [])
      return voices.map((voice) => ({ ...voice, engine: id as SpeechEngineId }))
    })
  )
  return lists.flat()
}

export interface SpeechEngineDescription {
  id: SpeechEngineId
  label: string
  description: string
  available: boolean
  reason?: string
}

export async function describeSpeechEngines(): Promise<SpeechEngineDescription[]> {
  return Promise.all(
    Object.values(SPEECH_ENGINES).map(async (engine) => {
      const { available, reason } = await engine
        .isAvailable()
        .catch(() => ({ available: false, reason: 'This engine could not be reached.' }))
      return { id: engine.id as SpeechEngineId, label: engine.label, description: engine.description, available, reason }
    })
  )
}
