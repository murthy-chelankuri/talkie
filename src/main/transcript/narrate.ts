import { homedir } from 'os'
import { join } from 'path'
import { findProjectDir } from '../project/paths'
import {
  readTranscript,
  readTimeline,
  updateTranscriptSegmentAudio,
  updateTimelineItemDuration
} from '../project/projectApi'
import { sayTtsProvider } from '../tts/sayTtsProvider'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { FPS } from '../../remotion/constants'
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

  const audioFileName = `${segmentId}.wav`
  const audioPath = join(dir, 'audio', audioFileName)
  await sayTtsProvider.synthesize(segment.text, audioPath)

  const durationSeconds = getWavDurationSeconds(audioPath)
  const durationFrames = Math.max(1, Math.round(durationSeconds * FPS))

  // An image has no length of its own, so the narration defines it. A video does: shrinking it
  // to fit a shorter narration would silently cut the recording off, so only ever grow it.
  const linkedItem = readTimeline(projectId, baseDir).find((item) => item.id === segment.timelineItemId)
  const nextDuration =
    linkedItem && linkedItem.kind === 'video' ? Math.max(linkedItem.duration, durationFrames) : durationFrames
  updateTimelineItemDuration(projectId, segment.timelineItemId, nextDuration, baseDir)

  return updateTranscriptSegmentAudio(projectId, segmentId, audioFileName, baseDir)
}
