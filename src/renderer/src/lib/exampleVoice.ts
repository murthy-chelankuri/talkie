/**
 * What to tell someone opening an example whose takes are in a voice they do not have.
 *
 * The examples are voiced with Kokoro, and a new install speaks with macOS's voice. Every take is
 * then honestly marked as another voice's, which on someone's first project reads like a fault;
 * and re-speaking a clip after changing a word drops a different voice into the middle of it. One
 * line says why, and where the matching voice is.
 */
export function exampleVoiceNote({
  example,
  engine,
  otherVoiceClips
}: {
  /** Which shipped example the project came from, if it did. */
  example: string | undefined
  /** The speech engine set in Settings. */
  engine: string
  /** How many clips speak in a voice other than the one this project would use now. */
  otherVoiceClips: number
}): string | null {
  if (!example || engine === 'kokoro' || otherVoiceClips === 0) return null
  return 'This example was voiced with Kokoro. Choose it in Settings → AI, and anything you re-speak will match.'
}
