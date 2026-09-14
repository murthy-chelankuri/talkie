import { RenderInternals } from '@remotion/renderer'
import { ffOptions } from '../render/binaries'

/** A stretch of one page's video: where the person was looking, and for how long. */
export interface RecordedClip {
  /** The page's own recording. Several clips can come from the same file. */
  videoPath: string
  /** Milliseconds into that file where this stretch begins. */
  trimBeforeMs: number
  durationMs: number
  /**
   * Milliseconds into the session — not into the file — where this stretch begins.
   *
   * The two differ as soon as there is a second tab, and the action log is written in session
   * time. This is what lets the log be put back onto the stitched video's own clock.
   */
  fromSessionMs: number
}

// Playwright writes VP8 .webm with roughly one keyframe every five seconds and no seek index,
// which Chromium can barely seek and cannot decode fast enough to hold 30fps. Converting to
// H.264 with a keyframe every second makes recordings seekable and hardware-decodable. The
// binary comes from Remotion's own bundled ffmpeg, so this adds no dependency.
const KEYFRAME_INTERVAL_FRAMES = '30'

const ENCODE_ARGS = [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '23',
  '-g',
  KEYFRAME_INTERVAL_FRAMES,
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  '-y'
]

function seconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3)
}

/**
 * Join what the person actually watched into one seekable file.
 *
 * A recording is not one page. Open a link in a new tab and Playwright starts a second video;
 * close the first tab and the first video ends there. Talkie used to keep only the page the
 * recording started on, so a session that moved to a second tab was cut short at the move and
 * the rest was left on disk in a file nothing ever looked at. Every page's footage is cut to
 * the stretches it was the one on screen and the stretches are laid end to end here, which is
 * also where the conversion to H.264 happens — one pass rather than one per page.
 */
export async function stitchRecording(clips: RecordedClip[], outputPath: string): Promise<string> {
  if (clips.length === 0) {
    throw new Error('The recording produced no video')
  }

  const inputs = clips.flatMap((clip) => [
    '-ss',
    seconds(clip.trimBeforeMs),
    '-t',
    seconds(clip.durationMs),
    '-i',
    clip.videoPath
  ])

  // One input needs no filter graph, and a graph is the part most likely to fail on an odd
  // capture — so the common case does not pay for the uncommon one.
  const join =
    clips.length === 1
      ? []
      : [
          '-filter_complex',
          `${clips.map((_, i) => `[${i}:v]`).join('')}concat=n=${clips.length}:v=1:a=0[out]`,
          '-map',
          '[out]'
        ]

  try {
    await RenderInternals.callFf({
      bin: 'ffmpeg',
      args: [...inputs, ...join, ...ENCODE_ARGS, outputPath],
      ...ffOptions(),
      cancelSignal: undefined
    })
    return outputPath
  } catch (err) {
    // The raw captures are already safely on disk, so a failed stitch must not lose the
    // recording — fall back to the first page's file and accept the slower playback.
    console.error(`Could not stitch the recording into ${outputPath}:`, err)
    return clips[0].videoPath
  }
}
