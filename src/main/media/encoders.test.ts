import { describe, expect, it } from 'vitest'
import { chooseH264, h264 } from './encoders'

describe('choosing an H.264 encoder', () => {
  it('uses the Mac’s hardware encoder, at the quality recordings were stitched at', () => {
    expect(chooseH264('darwin', new Set(['h264_videotoolbox', 'aac']), 'intermediate')).toEqual(['-c:v', 'h264_videotoolbox', '-q:v', '65'])
  })

  it('refuses plainly on a system with no encoder Talkie has chosen, rather than reaching for a GPL one', () => {
    expect(() => chooseH264('win32', new Set(['libx264']), 'intermediate')).toThrow(/No H\.264 encoder/)
    expect(() => chooseH264('darwin', new Set(['libx264']), 'intermediate')).toThrow(/No H\.264 encoder/)
  })

  it.runIf(process.platform === 'darwin')('finds the hardware encoder in the pinned build', async () => {
    expect(await h264('intermediate')).toEqual(['-c:v', 'h264_videotoolbox', '-q:v', '65'])
  }, 60_000)
})
