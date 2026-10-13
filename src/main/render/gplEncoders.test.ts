import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * x264 and x265 are GPL, and they are what make Remotion's bundled ffmpeg a GPL binary. Asking
 * for them is what would put the obligation back: shipping a build would mean offering the
 * corresponding source to every recipient, and the Mac App Store would stay closed.
 *
 * Nothing Talkie does needs them. Every encode it performs — the stitched recording and the
 * export — is served by VideoToolbox, which is built into every Mac it runs on and carries no
 * licence with it. That is a property of the whole main process rather than of one file, and it
 * is the kind that returns quietly: `-crf` and `-preset` are the familiar flags, and reaching
 * for them means reaching for libx264. So the source is read rather than any one constant.
 *
 * Choosing the hardware encoder does not make the shipped ffmpeg less GPL — that was settled
 * when it was linked. What this keeps true is that no feature depends on it, which is what
 * makes a non-GPL build of ffmpeg a substitution rather than a rewrite. See NOTICE.
 */
const MAIN = join(__dirname, '..')

const GPL_ENCODERS = ['libx264', 'libx265']

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (entry.endsWith('.ts') && !entry.includes('.test.')) found.push(path)
  }
  return found
}

describe('the encoders the app asks for', () => {
  it('never names one whose licence would follow the build', () => {
    const offenders: string[] = []

    for (const file of sourceFiles(MAIN)) {
      const source = readFileSync(file, 'utf-8')
      // Only what is asked of ffmpeg, not prose: NOTICE and the comments above explain why
      // these are avoided, and naming them there has to stay allowed.
      for (const encoder of GPL_ENCODERS) {
        if (new RegExp(`['"\`]${encoder}['"\`]`).test(source)) {
          offenders.push(`${file.slice(MAIN.length + 1)} asks for ${encoder}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('encodes the stitched recording with the hardware encoder', () => {
    const source = readFileSync(join(MAIN, 'capture', 'stitchRecording.ts'), 'utf-8')

    // The choice lives in src/main/media's table now; the stitch must ask it rather than name one.
    expect(source).toContain("h264('intermediate')")
    expect(readFileSync(join(MAIN, 'media', 'encoders.ts'), 'utf-8')).toContain('h264_videotoolbox')
    // VideoToolbox rejects both, so their presence would mean the encoder had been changed back.
    expect(source).not.toMatch(/'-crf'/)
    expect(source).not.toMatch(/'-preset'/)
  })

  it('asks Remotion to render with hardware acceleration', () => {
    const source = readFileSync(join(MAIN, 'render', 'renderProject.ts'), 'utf-8')

    expect(source).toMatch(/hardwareAcceleration:\s*'(if-possible|required)'/)
  })
})
