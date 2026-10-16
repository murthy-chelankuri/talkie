import { homedir } from 'os'
import { join } from 'path'
import { writeFileSync } from 'fs'
import {
  readTimelineLenient,
  readNarrationAudioPaths,
  readTranscript,
  openProject
} from '../project/projectApi'
import { slugify } from '../project/slug'
import { findProjectDir, projectsRootDir } from '../project/paths'
import { buildCaptions, toSrt } from '../transcript/captions'
import { burnedCaptionsFor } from '../transcript/burnedCaptions'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { computeTimelineDuration } from '../../composition/timelineDuration'
import type { TimelineItem as CompositionTimelineItem } from '../../composition/types'
import { beatsByItem } from '../transcript/captions'
import { getAssetServer, resolveTimelineAssetUrls } from './assetServer'
import { readVersions } from '../project/versionsStore'
import { activeVersion, FULL_VIDEO, playable } from '../project/versions'
import { levelExport } from './loudness'
import { redrawStaleDiagrams } from '../themes/projectDiagrams'
import { redrawStalePosters } from '../htmlScene/htmlSceneApi'
import { toRenderTheme } from '../themes/toRenderTheme'
import { finishing, preparing, type ExportProgress } from './exportProgress'
import { exportVideo } from './exporter/exportVideo'

/** `checkout-demo-2026-09-11` — the project, and when it was rendered. */
export function exportFileName(projectName: string, now: Date = new Date()): string {
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')

  return `${slugify(projectName)}-${day}`
}

export type RenderOptions = {
  /** Told what the export is doing as it goes. See exportProgress.ts. */
  onProgress?: (progress: ExportProgress) => void
  /** Stops the export part way; it then rejects. */
  signal?: AbortSignal
}

export async function renderProjectVideo(
  id: string,
  baseDir: string = homedir(),
  options: RenderOptions = {}
): Promise<string> {
  const { onProgress, signal } = options
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }
  onProgress?.(preparing())

  // Before anything is read: a theme changed since the project was last open leaves diagrams
  // drawn in the old colours, and the video should show the theme as it is now.
  await redrawStaleDiagrams(id, baseDir)
  await redrawStalePosters(id, baseDir)

  const rootDir = projectsRootDir(baseDir)
  // Cast: project/timeline/schema.ts's zod-inferred TimelineItem treats `data` as optional
  // (z.unknown() accepts undefined), while composition/types.ts's hand-written TimelineItem
  // requires it. Both describe the same real shape validated by TimelineItemSchema.superRefine
  // (every item's `data` is checked against its kind's schema, so it's always present) — the
  // optionality is a static-typing artifact of two independently-defined interfaces, not a
  // runtime possibility.
  // The version being worked on: the scenes it leaves out are not in the video. See versions.ts.
  const versions = readVersions(id, baseDir)
  const version = activeVersion(versions)
  const rawTimeline = playable(readTimelineLenient(id, baseDir) as unknown as CompositionTimelineItem[], version.leftOut)
  const assetServer = await getAssetServer(rootDir)
  const narrationAudioPaths = readNarrationAudioPaths(id, baseDir)
  const timeline = resolveTimelineAssetUrls(
    rawTimeline,
    rootDir,
    assetServer.url,
    narrationAudioPaths,
    burnedCaptionsFor(id, baseDir),
    beatsByItem(readTranscript(id, baseDir))
  )

  // The same theme the preview draws with, built the same way. See toRenderTheme.
  const theme = toRenderTheme(openProject(id, baseDir).themeId, baseDir)
  // Named for the project and the day it was made, because this is the file the user hands to
  // somebody: `export-1789179493000.mp4` tells its owner nothing about what it is.
  // And for the version, where it is not the whole thing: two cuts exported the same day must not
  // overwrite each other, or be mistaken for each other once sent.
  const named = version.id === FULL_VIDEO.id ? openProject(id, baseDir).name : `${openProject(id, baseDir).name} — ${version.name}`
  const outputPath = join(dir, 'renders', `${exportFileName(named)}.mp4`)
  const totalFrames = computeTimelineDuration(rawTimeline)
  onProgress?.(preparing(totalFrames))

  await exportVideo({
    timeline,
    rawTimeline,
    theme,
    totalFrames,
    narration: narrationAudioPaths,
    serverUrl: assetServer.url,
    outputPath,
    onProgress,
    signal
  })

  // The soundtrack brought to the level spoken video is delivered at, once the whole of it
  // exists to be measured. See loudness.ts.
  onProgress?.(finishing(totalFrames))
  await levelExport(outputPath)

  writeCaptionsBeside(outputPath, id, baseDir)

  return outputPath
}

/**
 * The narration as a subtitle file, written next to the video it belongs to.
 *
 * Beside rather than burned in: captions are the first thing anyone needs to correct, and a
 * word painted into the picture cannot be corrected without rendering the whole thing again.
 * Every player and every upload form reads SubRip, so this is the form that travels.
 *
 * Never fatal. The video is finished and on disk by this point, and a missing sidecar is not a
 * reason to tell someone their export failed.
 */
function writeCaptionsBeside(outputPath: string, id: string, baseDir: string): void {
  try {
    const captions = buildCaptions(
      readTimelineLenient(id, baseDir),
      readTranscript(id, baseDir),
      (segment) => durationOfTake(id, segment.audioFile, baseDir)
    )
    if (captions.length === 0) return

    writeFileSync(outputPath.replace(/\.mp4$/, '.srt'), toSrt(captions), 'utf-8')
  } catch (err) {
    console.error('Could not write the caption file beside the video:', err)
  }
}

function durationOfTake(id: string, audioFile: string | undefined, baseDir: string): number | undefined {
  if (!audioFile) return undefined
  const dir = findProjectDir(id, baseDir)
  if (!dir) return undefined

  try {
    return getWavDurationSeconds(join(dir, 'audio', audioFile))
  } catch {
    // A take whose file has gone is one the video does not play either.
    return undefined
  }
}
