import { RenderInternals } from '@remotion/renderer'

// Playwright writes VP8 .webm with roughly one keyframe every five seconds and no seek index,
// which Chromium can barely seek and cannot decode fast enough to hold 30fps. Converting to
// H.264 with a keyframe every second makes recordings seekable and hardware-decodable. The
// binary comes from Remotion's own bundled ffmpeg, so this adds no dependency.
const KEYFRAME_INTERVAL_FRAMES = '30'

export async function normalizeRecording(videoPath: string): Promise<string> {
  const normalizedPath = videoPath.replace(/\.webm$/, '.mp4')

  try {
    await RenderInternals.callFf({
      bin: 'ffmpeg',
      args: [
        '-i',
        videoPath,
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
        '-y',
        normalizedPath
      ],
      indent: false,
      logLevel: 'error',
      binariesDirectory: null,
      cancelSignal: undefined
    })
    return normalizedPath
  } catch (err) {
    // The raw capture is already safely on disk, so a failed conversion must not lose the
    // recording — fall back to it and accept the slower playback.
    console.error(`Could not convert recording ${videoPath} to mp4:`, err)
    return videoPath
  }
}
