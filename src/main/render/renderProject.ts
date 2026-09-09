import { homedir } from 'os'
import { join } from 'path'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { readTimelineLenient, readNarrationAudioPaths } from '../project/projectApi'
import { findProjectDir, projectsRootDir } from '../project/paths'
import { computeTimelineDuration } from '../../remotion/timelineDuration'
import type { TimelineItem as RemotionTimelineItem } from '../../remotion/types'
import { getAssetServer, resolveTimelineAssetUrls } from './assetServer'
import { COMPOSITION_ID } from '../../remotion/constants'

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
  const timeline = resolveTimelineAssetUrls(rawTimeline, rootDir, assetServer.url, narrationAudioPaths)

  const bundleLocation = await bundle({ entryPoint: join(process.cwd(), 'src/remotion/index.tsx') })
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: COMPOSITION_ID,
    inputProps: { timeline }
  })

  const outputPath = join(dir, 'renders', `export-${Date.now()}.mp4`)

  await renderMedia({
    composition: { ...composition, durationInFrames: computeTimelineDuration(rawTimeline) },
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps: { timeline }
  })

  return outputPath
}
