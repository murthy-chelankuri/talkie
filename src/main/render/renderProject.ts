import { homedir } from 'os'
import { join } from 'path'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
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
import { computeTimelineDuration } from '../../remotion/timelineDuration'
import type { TimelineItem as RemotionTimelineItem } from '../../remotion/types'
import { beatsByItem } from '../transcript/captions'
import { getAssetServer, resolveTimelineAssetUrls } from './assetServer'
import { COMPOSITION_ID } from '../../remotion/constants'

/** `checkout-demo-2026-09-11` — the project, and when it was rendered. */
export function exportFileName(projectName: string, now: Date = new Date()): string {
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')

  return `${slugify(projectName)}-${day}`
}

export async function renderProjectVideo(id: string, baseDir: string = homedir()): Promise<string> {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const rootDir = projectsRootDir(baseDir)
  // Cast: project/timeline/schema.ts's zod-inferred TimelineItem treats `data` as optional
  // (z.unknown() accepts undefined), while remotion/types.ts's hand-written TimelineItem
  // requires it. Both describe the same real shape validated by TimelineItemSchema.superRefine
  // (every item's `data` is checked against its kind's schema, so it's always present) — the
  // optionality is a static-typing artifact of two independently-defined interfaces, not a
  // runtime possibility.
  const rawTimeline = readTimelineLenient(id, baseDir) as unknown as RemotionTimelineItem[]
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

  const bundleLocation = await bundle({ entryPoint: join(process.cwd(), 'src/remotion/index.tsx') })
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: COMPOSITION_ID,
    inputProps: { timeline }
  })

  // Named for the project and the day it was made, because this is the file the user hands to
  // somebody: `export-1789179493000.mp4` tells its owner nothing about what it is.
  const outputPath = join(dir, 'renders', `${exportFileName(openProject(id, baseDir).name)}.mp4`)

  await renderMedia({
    composition: { ...composition, durationInFrames: computeTimelineDuration(rawTimeline) },
    serveUrl: bundleLocation,
    codec: 'h264',
    // Tagged as high-definition colour, which is what it is. Left to itself the file came out
    // marked bt470bg — the colour space of PAL television — with its transfer and primaries
    // unset, so any player that honoured the tag showed the wrong colours for a 1080p video.
    colorSpace: 'bt709',
    outputLocation: outputPath,
    inputProps: { timeline }
  })

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
