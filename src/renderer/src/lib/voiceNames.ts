import type { Voice } from '../api/projectClient'

/**
 * Match a stored voice name to a voice the machine actually offers.
 *
 * macOS 27 started qualifying some names with their language — `Samantha (English (US))` where
 * earlier releases said `Samantha`. `say -v` still answers to either, so narration kept working,
 * but the picker is a `<select>`: a value no option carries shows as whatever sits at the top of
 * the list, so a project narrated by Samantha appeared to be set to something else, and touching
 * the control at all silently changed the voice.
 *
 * Names stay stored as they were chosen. Only the display is resolved, so a settings file written
 * by an older macOS still reads correctly on a newer one and the other way round.
 */
export function resolveVoiceName(stored: string, voices: Voice[]): string {
  if (!stored) return stored
  if (voices.some((voice) => voice.name === stored)) return stored

  // Only the qualifier may differ. A name that merely starts the same — `Eddy` against
  // `Eddystone` — is a different voice, so the bracket is part of what has to match.
  const qualified = voices.find((voice) => voice.name.startsWith(`${stored} (`))
  return qualified ? qualified.name : stored
}
