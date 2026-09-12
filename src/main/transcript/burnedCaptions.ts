import { homedir } from 'os'
import { join } from 'path'
import { readTimelineLenient, readTranscript } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { readSettings } from '../settings/settingsStore'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { captionsByItem, type Caption } from './captions'

/**
 * Cues for the composition, but only when the user has asked for words in the picture.
 *
 * Computed in the same place for the preview and the export, so what the editor shows is what
 * renders — a caption that appeared only in the finished file would be a surprise, and one that
 * appeared only in the preview would be a lie.
 */
export function burnedCaptionsFor(projectId: string, baseDir: string = homedir()): Record<string, Caption[]> {
  if (!readSettings(baseDir).export.burnCaptions) return {}

  const dir = findProjectDir(projectId, baseDir)
  if (!dir) return {}

  try {
    return captionsByItem(
      readTimelineLenient(projectId, baseDir),
      readTranscript(projectId, baseDir),
      (segment) =>
        segment.audioFile ? getWavDurationSeconds(join(dir, 'audio', segment.audioFile)) : undefined
    )
  } catch {
    // A take whose file has gone is one the video does not play either.
    return {}
  }
}
