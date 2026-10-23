import { DEFAULT_KOKORO_VOICE, type SpeechEngineId } from '../settings/schema'
import type { TTSProvider, Voice } from './ttsProvider'
import { kokoroTtsProvider } from './kokoroTtsProvider'

export const SPEECH_ENGINES: Record<SpeechEngineId, TTSProvider> = {
  kokoro: kokoroTtsProvider
}

/** Falls back to Kokoro, the only engine, so a stale setting never leaves narration mute. */
export function speechEngine(id: SpeechEngineId): TTSProvider {
  return SPEECH_ENGINES[id] ?? kokoroTtsProvider
}

/**
 * The engine a voice is read by. Kokoro is the only one, so every voice is Kokoro's — but this
 * stays the one place that answers the question, so a second engine added later changes it here.
 */
export function engineOfVoice(_voice: string): SpeechEngineId {
  return 'kokoro'
}

/**
 * Who reads a project, and in which voice.
 *
 * A project's own voice brings its engine with it. It used to be a name only, read by whichever
 * engine the app was set to; now a project carries its own, which matters again the moment a
 * second engine returns.
 */
export function projectSpeech(
  projectVoice: string | undefined,
  app: { engine: SpeechEngineId; voice: string }
): { engine: SpeechEngineId; voice: string } {
  const own = projectVoice?.trim()
  if (own) return { engine: engineOfVoice(own), voice: own }
  return { engine: app.engine, voice: app.voice.trim() || DEFAULT_KOKORO_VOICE }
}

/**
 * Every voice a project can be read in, from every engine that is ready. An engine that is not
 * ready — Kokoro not yet downloaded — offers nothing, since choosing one of its voices would only
 * fail at the first take. The engine is stamped onto each voice only when more than one is offered;
 * with a single engine the mark is noise in the picker, and its absence groups voices by language.
 */
export async function allVoices(): Promise<Voice[]> {
  const ids = Object.keys(SPEECH_ENGINES) as SpeechEngineId[]
  const lists = await Promise.all(
    ids.map(async (id) => {
      const engine = SPEECH_ENGINES[id]
      const ready = await engine.isAvailable().catch(() => ({ available: false }))
      if (!ready.available) return []
      const voices = await engine.voices().catch(() => [])
      return voices.map((voice) => (ids.length > 1 ? { ...voice, engine: id } : voice))
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
