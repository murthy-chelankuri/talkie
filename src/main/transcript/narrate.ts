import { homedir } from 'os'
import { rmSync } from 'fs'
import { join } from 'path'
import { findProjectDir } from '../project/paths'
import {
  readTranscript,
  readTimeline,
  openProject,
  updateTranscriptSegmentAudio,
  updateTimelineItemDuration
} from '../project/projectApi'
import { speechEngine } from '../tts/engineRegistry'
import { readSettings } from '../settings/settingsStore'
import { DEFAULT_VOICE } from '../settings/schema'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../remotion/constants'
import { footageFrames, readFaster } from './fitToFootage'
import { assembleTake } from './assembleTake'
import { placeBeats } from './narrationBeats'
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
  const voice = openProject(projectId, baseDir).voice?.trim() || speech.voice.trim() || DEFAULT_VOICE
  const engine = speechEngine(speech.engine)
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
  // A timed take is read a beat at a time and the waits between them are made of silence, so the
  // words keep step with a recording whose events are not evenly spread. See narrationBeats.ts.
  const beats = segment.beats ?? []
  let durationSeconds: number
  if (beats.length > 1) {
    const pieces: { at: number; wavPath: string }[] = []
    const spoken: number[] = []
    for (const [index, beat] of beats.entries()) {
      const beatPath = `${audioPath}.beat${index}.wav`
      await engine.synthesize(beat.text, beatPath, delivery)
      spoken.push(getWavDurationSeconds(beatPath))
      pieces.push({ at: beat.at, wavPath: beatPath })
    }

    const room = (footage ?? linkedItem?.duration ?? 0) / FPS
    const at = placeBeats(beats, spoken, {
      leadInSeconds: NARRATION_LEAD_IN_FRAMES / FPS,
      roomSeconds: Math.max(room - NARRATION_TAIL_FRAMES / FPS, spoken.reduce((a, b) => a + b, 0))
    })

    // The take's own clock starts where the composition drops it in, so the lead-in the clip
    // already leaves is not counted twice.
    const offset = NARRATION_LEAD_IN_FRAMES / FPS
    const assembled = assembleTake(
      pieces.map((piece, index) => ({ ...piece, at: Math.max(0, at[index] - offset) })),
      audioPath
    )
    durationSeconds = assembled.seconds
    for (const piece of pieces) rmSync(piece.wavPath, { force: true })
  } else {
    await engine.synthesize(segment.text, audioPath, delivery)
    durationSeconds = getWavDurationSeconds(audioPath)
  }

  // A recording is as long as it is, so a take too long for it is read a little faster rather
  // than allowed to run on over a picture that has already ended. A timed take has already been
  // laid out inside the footage, so there is nothing left to hurry. See fitToFootage.ts.
  if (footage !== null && beats.length <= 1) {
    const fitted = await readFaster({
      text: segment.text,
      audioPath,
      spokenSeconds: durationSeconds,
      footageFrames: footage,
      delivery,
      synthesize: (text, outputPath, options) => engine.synthesize(text, outputPath, options)
    })
    if (fitted !== null) durationSeconds = fitted
  }

  // The clip has to hold the silence either side of the words as well as the words themselves,
  // or the pause would simply be cut off by the next clip starting.
  const durationFrames =
    Math.max(1, Math.round(durationSeconds * FPS)) + NARRATION_LEAD_IN_FRAMES + NARRATION_TAIL_FRAMES

  // An image has no length of its own, so the narration defines it. A video does: shrinking it
  // to fit a shorter narration would silently cut the recording off, so only ever grow it.
  const nextDuration =
    linkedItem && linkedItem.kind === 'video' ? Math.max(linkedItem.duration, durationFrames) : durationFrames
  updateTimelineItemDuration(projectId, segment.timelineItemId, nextDuration, baseDir)

  // Recording the voice is what lets the editor notice narration left over from a different one.
  return updateTranscriptSegmentAudio(projectId, segmentId, audioFileName, voice, baseDir)
}
