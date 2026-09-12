import { homedir } from 'os'
import { join } from 'path'
import { findProjectDir } from '../project/paths'
import {
  readTranscript,
  readTimeline,
  openProject,
  updateTranscriptSegmentAudio,
  updateTimelineItemDuration
} from '../project/projectApi'
import { sayTtsProvider } from '../tts/sayTtsProvider'
import { readSettings } from '../settings/settingsStore'
import { DEFAULT_VOICE } from '../settings/schema'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../remotion/constants'
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
  const voice =
    openProject(projectId, baseDir).voice?.trim() ||
    readSettings(baseDir).speech.voice.trim() ||
    DEFAULT_VOICE
  await sayTtsProvider.synthesize(segment.text, audioPath)

  const durationSeconds = getWavDurationSeconds(audioPath)
  // The clip has to hold the silence either side of the words as well as the words themselves,
  // or the pause would simply be cut off by the next clip starting.
  const durationFrames =
    Math.max(1, Math.round(durationSeconds * FPS)) + NARRATION_LEAD_IN_FRAMES + NARRATION_TAIL_FRAMES

  // An image has no length of its own, so the narration defines it. A video does: shrinking it
  // to fit a shorter narration would silently cut the recording off, so only ever grow it.
  const linkedItem = readTimeline(projectId, baseDir).find((item) => item.id === segment.timelineItemId)
  const nextDuration =
    linkedItem && linkedItem.kind === 'video' ? Math.max(linkedItem.duration, durationFrames) : durationFrames
  updateTimelineItemDuration(projectId, segment.timelineItemId, nextDuration, baseDir)

  // Recording the voice is what lets the editor notice narration left over from a different one.
  return updateTranscriptSegmentAudio(projectId, segmentId, audioFileName, voice, baseDir)
}
