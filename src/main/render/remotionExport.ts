import { join } from 'path'
import { makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer'
import type { TimelineItem as RemotionTimelineItem } from '../../remotion/types'
import type { RenderTheme } from '../../remotion/renderTheme'
import { COMPOSITION_ID } from '../../remotion/constants'
import { browserExecutablePath } from '../capture/resolveBrowser'
import { binariesDirectory } from './binaries'
import { remotionBundleLocation } from './remotionBundle'
import { rendering, type ExportProgress } from './exportProgress'

/**
 * Remotion's export, kept beside Talkie's own until the comparison test (exporter/compare/) has
 * shown the two agree and step 5 of the renderer removes it. `TALKIE_RENDERER=remotion` chooses it.
 */
export async function renderWithRemotion({
  timeline,
  theme,
  totalFrames,
  outputPath,
  onProgress,
  signal
}: {
  timeline: RemotionTimelineItem[]
  theme: RenderTheme | null
  totalFrames: number
  outputPath: string
  onProgress?: (progress: ExportProgress) => void
  signal?: AbortSignal
}): Promise<void> {
  // The bundle shipped with this build, or one made from source when there is none — never
  // through process.cwd(), which is `/` for an app opened from Finder. The source path is
  // relative to this file rather than to the working directory for the same reason; in a
  // packaged build the shipped bundle answers first and it is never reached. See
  // remotionBundle.ts.
  const bundleLocation = await remotionBundleLocation(join(__dirname, '../../video/remotionEntry.tsx'))
  // Both calls are given a browser for the same reason they are given the binaries: left to
  // find their own, they derive the place to put it from the working directory, which is `/`
  // for an app opened from Finder. See browserExecutablePath.
  const browserExecutable = browserExecutablePath()
  const composition = await selectComposition({
    binariesDirectory: binariesDirectory(),
    browserExecutable,
    serveUrl: bundleLocation,
    id: COMPOSITION_ID,
    inputProps: { timeline, theme }
  })

  // Remotion takes its own cancel signal; the rest of Talkie speaks AbortSignal.
  const { cancelSignal, cancel } = makeCancelSignal()
  if (signal?.aborted) cancel()
  signal?.addEventListener('abort', () => cancel(), { once: true })

  await renderMedia({
    binariesDirectory: binariesDirectory(),
    browserExecutable,
    composition: { ...composition, durationInFrames: totalFrames },
    onProgress: (report) => onProgress?.(rendering(report, totalFrames)),
    cancelSignal,
    serveUrl: bundleLocation,
    codec: 'h264',
    // The hardware encoder, for the licensing reason set out in stitchRecording.ts: libx264 is
    // what makes the bundled ffmpeg GPL, and nothing here needs it. `if-possible` rather than
    // `required` because a failed export is a worse outcome than a fallback — though on Apple
    // Silicon, which is the only hardware this app supports, the fallback cannot be reached.
    hardwareAcceleration: 'if-possible',
    // Tagged as high-definition colour, which is what it is. Left to itself the file came out
    // marked bt470bg — the colour space of PAL television — with its transfer and primaries
    // unset, so any player that honoured the tag showed the wrong colours for a 1080p video.
    colorSpace: 'bt709',
    outputLocation: outputPath,
    inputProps: { timeline, theme }
  })
}
