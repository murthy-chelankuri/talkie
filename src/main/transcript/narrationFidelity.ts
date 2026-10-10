import { homedir } from 'os'
import { join } from 'path'
import { findProjectDir } from '../project/paths'
import { readTranscript } from '../project/projectApi'
import { RECORDED_VOICE } from './schema'
import { readWavFormat } from '../tts/wavDuration'
import { summariseFidelity, type NarrationFidelity } from '../tts/voiceFidelity'
import { isKokoroVoiceName } from '../tts/kokoroTtsProvider'

/** OpenAI's voices, which an earlier build could narrate in. Only here so old takes are judged fairly. */
const EARLIER_CLOUD_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'])

/**
 * What is limiting the sound of this project, read from the takes themselves.
 *
 * Measured rather than assumed: the app cannot know which voices a machine has installed, and
 * guessing from a voice's name would be wrong the moment someone downloads the better version of
 * it. The files that will be mixed into the export are the only honest source, and their headers
 * answer it for the cost of a few kilobytes each.
 */
export function narrationFidelityFor(
  projectId: string,
  baseDir: string = homedir()
): NarrationFidelity | null {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) return null

  try {
    const takes = readTranscript(projectId, baseDir)
      .filter((segment) => segment.status === 'narrated' && segment.audioFile)
      // A take the user recorded themselves is their own microphone, not a voice they can swap
      // for a better download — telling them to visit Manage Voices would be no help at all.
      .filter((segment) => segment.voice !== RECORDED_VOICE)
      // Nor is a take from a model voice. Kokoro delivers 24 kHz, which is simply what it is;
      // there is no better download of it behind a macOS settings pane. Takes from the OpenAI
      // voices an earlier build offered are the same, and can still be sitting in a project.
      .filter((segment) => !segment.voice || !(isKokoroVoiceName(segment.voice) || EARLIER_CLOUD_VOICES.has(segment.voice)))
      .map((segment) => {
        try {
          const { sampleRate } = readWavFormat(join(dir, 'audio', segment.audioFile as string))
          return { sampleRate, voice: segment.voice }
        } catch {
          // A take whose file has gone is not one the export will play either.
          return { sampleRate: 0, voice: segment.voice }
        }
      })

    return summariseFidelity(takes)
  } catch {
    return null
  }
}
