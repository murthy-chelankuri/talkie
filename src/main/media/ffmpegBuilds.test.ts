import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * The ffmpeg Talkie runs is pinned: a release that changed upstream must not change what a
 * recording or an export does, or what was downloaded, without anyone choosing it.
 */
type Binary = { url: string; sha256: string }
const table = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'ffmpegBuilds.json'), 'utf-8')) as {
  source: string
  licence: string
  builds: Record<string, { version: string; ffmpeg: Binary; ffprobe: Binary }>
}

describe('the pinned ffmpeg builds', () => {
  it('pin every binary to one exact file from the one build server', () => {
    for (const [key, build] of Object.entries(table.builds)) {
      for (const binary of [build.ffmpeg, build.ffprobe]) {
        expect(binary.url, key).toMatch(new RegExp(`^${table.source}/download/(macos|linux)/(arm64|amd64)/\\d+_${build.version.replace(/\./g, '\\.')}/ff(mpeg|probe)\\.zip$`))
        expect(binary.sha256, key).toMatch(/^[0-9a-f]{64}$/)
      }
    }
  })

  it('pair each ffprobe with the ffmpeg from the same build', () => {
    for (const build of Object.values(table.builds)) {
      expect(build.ffprobe.url.replace('ffprobe.zip', '')).toBe(build.ffmpeg.url.replace('ffmpeg.zip', ''))
    }
  })

  it('cover macOS and Linux on both architectures', () => {
    expect(Object.keys(table.builds).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'])
  })

  it('are a licence Talkie can say it uses', () => {
    expect(table.licence).toBe('GPL-3.0-or-later')
  })
})
