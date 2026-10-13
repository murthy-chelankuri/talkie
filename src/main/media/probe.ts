import { runFfprobe } from './run'

export type MediaInfo = {
  durationSeconds: number | null
  width: number | null
  height: number | null
  fps: number | null
  videoCodec: string | null
  hasAudio: boolean
}

type Probed = {
  format?: { duration?: string }
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string }[]
}

/** "30/1" as 30; ffprobe writes "0/0" for a rate it does not know. */
function rate(fraction: string | undefined): number | null {
  const [numerator, denominator] = (fraction ?? '').split('/').map(Number)
  return numerator > 0 && denominator > 0 ? numerator / denominator : null
}

function seconds(value: string | undefined): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** What a recording, a take or an export is: how long, how big, and whether it has sound. */
export async function probeMedia(path: string): Promise<MediaInfo> {
  const { stdout } = await runFfprobe(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path])
  const probed = JSON.parse(stdout) as Probed
  const video = probed.streams?.find((stream) => stream.codec_type === 'video')
  return {
    // The container's length where it has one; a stream's otherwise.
    durationSeconds: seconds(probed.format?.duration) ?? seconds(video?.duration),
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: rate(video?.avg_frame_rate),
    videoCodec: video?.codec_name ?? null,
    hasAudio: probed.streams?.some((stream) => stream.codec_type === 'audio') ?? false
  }
}
