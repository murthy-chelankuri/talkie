import { homedir } from 'os'
import { join } from 'path'
import { findProjectDir } from '../project/paths'
import { readTranscript, updateTranscriptSegmentAudio, updateTimelineItemDuration } from '../project/projectApi'
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
  updateTimelineItemDuration(projectId, segment.timelineItemId, durationFrames, baseDir)

  return updateTranscriptSegmentAudio(projectId, segmentId, audioFileName, baseDir)
}
