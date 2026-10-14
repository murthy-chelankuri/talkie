import { runFfmpeg } from './run'

/** What an encode is for: a stitched recording, or the video someone is given. */
export type EncodePurpose = 'intermediate' | 'export'

type Encoder = { name: string; quality: Record<EncodePurpose, string[]> }

/**
 * The export's quality on VideoToolbox: the value that brought the shipped examples within 10% of
 * the file sizes the previous renderer made, with nothing a viewer would see given up.
 */
const EXPORT_QUALITY = '92'

/**
 * Each system's H.264 encoders, best first; the first the installed ffmpeg offers is used.
 * The macOS row is hardware only: a hardware encoder carries no licence with it, which is what
 * keeps a build of ffmpeg without the GPL ones a substitution rather than a rewrite (see
 * gplEncoders.test.ts). What the other systems' rows hold, Linux's last resort included, is
 * project 2's decision.
 */
const H264: Partial<Record<NodeJS.Platform, Encoder[]>> = {
  // VideoToolbox takes `-q:v`, not `-crf`, and has no `-preset` because the encoder is
  // fixed-function. 65 is a little richer than the crf 23 it replaced, deliberately: this file is
  // the source the final render reads, so its losses are inherited, and a hardware encode is
  // cheap enough that the extra bits cost nothing worth counting.
  darwin: [{ name: 'h264_videotoolbox', quality: { intermediate: ['-q:v', '65'], export: ['-q:v', EXPORT_QUALITY] } }]
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
