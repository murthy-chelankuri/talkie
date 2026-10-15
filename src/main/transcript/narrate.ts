import { homedir } from 'os'
import { join } from 'path'
import { findProjectDir } from '../project/paths'
import {
  readTranscript,
  readTimeline,
  openProject,
  updateTranscriptSegmentAudio,
  fitClipToNarration
} from '../project/projectApi'
import { speechEngine } from '../tts/engineRegistry'
import { readSettings } from '../settings/settingsStore'
import { DEFAULT_VOICE } from '../settings/schema'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { levelTake } from '../render/loudness'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../composition/constants'
import { footageFrames, readFaster } from './fitToFootage'
import { readTimedTake } from './readTimedTake'
import { toSpokenForm } from '../project/projectContext'
import type { SpeechOptions } from '../tts/ttsProvider'
import type { TranscriptSegment } from './schema'

export async function narrateSegment(
  projectId: string,
  segmentId: string,
  baseDir: string = homedir()
): Promise<TranscriptSegment> {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${projectId}`)
  }

  const transcript = readTranscript(projectId, baseDir)
  const segment = transcript.find((s) => s.id === segmentId)
  if (!segment) {
    throw new Error(`No transcript segment found with id ${segmentId}`)
  }

  // A new file per take: overwriting one name would make undo restore the old words next to
  // the new voice, and would let a cached URL keep playing the wrong audio.
  const audioFileName = `${segmentId}-${Date.now()}.wav`
  const audioPath = join(dir, 'audio', audioFileName)
  // The project's own voice wins over the app's, so a project keeps sounding like itself.
  const speech = readSettings(baseDir).speech
  const project = openProject(projectId, baseDir)
  const voice = project.voice?.trim() || speech.voice.trim() || DEFAULT_VOICE
  const engine = speechEngine(speech.engine)
  // The voice is handed the words as they should be heard; everything else keeps them as they are
  // written. Every route to the engine below goes through this one. See toSpokenForm.
  const speak = (text: string, outputPath: string, options: SpeechOptions): Promise<void> =>
    engine.synthesize(toSpokenForm(text, project.context?.pronunciations), outputPath, options)
  const delivery = {
    voice,
    pace: speech.pace,
    sentencePauseMs: speech.sentencePauseMs,
    clausePauseMs: speech.clausePauseMs
  }

  const linkedItem = readTimeline(projectId, baseDir).find((item) => item.id === segment.timelineItemId)
  const footage = await footageFrames(linkedItem)

  // Handed the voice rather than letting the engine look one up: an engine reading settings for
  // itself spoke in the app's voice while the take was labelled with the project's.
  //
  // A recording is as long as it is, so either way a take too long for its scene is read a
  // little faster rather than allowed to run on over a picture that has already moved on.
  const beats = segment.beats ?? []
  let durationSeconds: number

  if (beats.length > 1) {
    // Read a beat at a time, with real silence between, so the voice waits when the screen
    // does — and read again slightly faster if it still lands late. See readTimedTake.ts.
    durationSeconds = await readTimedTake({
      beats,
      audioPath,
      footageFrames: footage,
      delivery,
      synthesize: speak
    })
  } else {
    await speak(segment.text, audioPath, delivery)
    durationSeconds = getWavDurationSeconds(audioPath)

    if (footage !== null) {
      const fitted = await readFaster({
        text: segment.text,
        audioPath,
        spokenSeconds: durationSeconds,
        footageFrames: footage,
        delivery,
        synthesize: speak
      })
      if (fitted !== null) durationSeconds = fitted
    }
  }

  // Every engine comes out at a level of its own; a project that mixes them should not jump in
  // volume at the cut between one clip and the next. Loudness only, so the timing above stands.
  await levelTake(audioPath)

  // The clip has to hold the silence either side of the words as well as the words themselves,
  // or the pause would simply be cut off by the next clip starting.
  const durationFrames =
    Math.max(1, Math.round(durationSeconds * FPS)) + NARRATION_LEAD_IN_FRAMES + NARRATION_TAIL_FRAMES

  // Where the extra time comes from is not this function's business: a slide simply takes it, and
  // a scene cut out of a recording moves its cut later so it plays more of the footage rather
  // than holding a still. See fitClipToNarration.
  fitClipToNarration(projectId, segment.timelineItemId, durationFrames, baseDir)

  // Recording the voice is what lets the editor notice narration left over from a different one.
  return updateTranscriptSegmentAudio(projectId, segmentId, audioFileName, voice, baseDir)
}
