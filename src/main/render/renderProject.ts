import { homedir } from 'os'
import { join } from 'path'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { readTimeline } from '../project/projectApi'
import { findProjectDir, projectsRootDir } from '../project/paths'
import { computeTimelineDuration } from '../../remotion/timelineDuration'
import type { TimelineItem as RemotionTimelineItem } from '../../remotion/types'
import { getAssetServer, resolveTimelineAssetUrls } from './assetServer'

// Remotion's composition id. Not statically imported from '../../remotion/index' (a .tsx file):
// tsconfig.node.json (which typechecks src/main/**/*) has no "jsx" compiler option, so pulling
// that module into the program fails to parse. src/main/render/composition.test.ts hit the same
// constraint and worked around it the same way, treating the id as a plain string.
const COMPOSITION_ID = 'Demo'

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
  const rawTimeline = readTimeline(id, baseDir) as unknown as RemotionTimelineItem[]
  const assetServer = await getAssetServer(rootDir)
  const timeline = resolveTimelineAssetUrls(rawTimeline, rootDir, assetServer.url)

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
