import { runFfmpeg } from './run'

/** What an encode is for. Step 3 of the renderer adds 'export', with the quality it chooses. */
export type EncodePurpose = 'intermediate'

type Encoder = { name: string; quality: Record<EncodePurpose, string[]> }

/**
 * Each system's H.264 encoders, best first; the first the installed ffmpeg offers is used.
 * Hardware encoders only: they carry no licence with them, which is what keeps a build of
 * ffmpeg without the GPL ones a substitution rather than a rewrite (see gplEncoders.test.ts).
 * Windows and Linux rows arrive with project 2.
 */
const H264: Partial<Record<NodeJS.Platform, Encoder[]>> = {
  // -q:v 65 is what recordings have always been stitched at: a small file that seeks cleanly.
  darwin: [{ name: 'h264_videotoolbox', quality: { intermediate: ['-q:v', '65'] } }]
}

export function chooseH264(platform: NodeJS.Platform, offered: ReadonlySet<string>, purpose: EncodePurpose): string[] {
  const encoder = (H264[platform] ?? []).find((candidate) => offered.has(candidate.name))
  if (!encoder) throw new Error(`No H.264 encoder Talkie can use on ${platform} is in this ffmpeg.`)
  return ['-c:v', encoder.name, ...encoder.quality[purpose]]
}

let offered: Promise<Set<string>> | null = null

/** Asked once: the list does not change while the app runs. */
function offeredEncoders(): Promise<Set<string>> {
  offered ??= runFfmpeg(['-hide_banner', '-encoders'])
    .then(({ stdout }) => new Set(stdout.split('\n').flatMap((line) => /^\s[VAS][A-Z.]{5}\s+(\S+)/.exec(line)?.[1] ?? [])))
    .catch((err: unknown) => {
      // Not remembered: a failure here is worth asking again about, not caching.
      offered = null
      throw err
    })
  return offered
}

export async function h264(purpose: EncodePurpose): Promise<string[]> {
  return chooseH264(process.platform, await offeredEncoders(), purpose)
}
