import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ffmpegPath, ffprobePath, packagedResources, toolPath } from './binaries'

const KEY = `${process.platform}-${process.arch}`
let scratch: string | null = null
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
  scratch = null
})

describe('finding ffmpeg', () => {
  it('finds the copy a packaged build carries beside its archive, from inside or outside it', () => {
    const resources = join('/Applications', 'Talkie.app', 'Contents', 'Resources')

    expect(toolPath('ffmpeg', join(resources, 'app.asar', 'out', 'main'))).toBe(join(resources, 'ffmpeg', 'ffmpeg'))
    // The MCP server runs as plain node from the unpacked copy, where there is no resourcesPath.
    expect(toolPath('ffprobe', join(resources, 'app.asar.unpacked', 'out', 'mcp'))).toBe(join(resources, 'ffmpeg', 'ffprobe'))
  })

  it('finds the fetched copy from anywhere in a checkout, sources or build', () => {
    scratch = mkdtempSync(join(tmpdir(), 'talkie-media-'))
    mkdirSync(join(scratch, 'vendor', 'ffmpeg', KEY), { recursive: true })
    writeFileSync(join(scratch, 'vendor', 'ffmpeg', KEY, 'ffmpeg'), '')
    mkdirSync(join(scratch, 'src', 'main', 'media'), { recursive: true })

    expect(toolPath('ffmpeg', join(scratch, 'src', 'main', 'media'))).toBe(join(scratch, 'vendor', 'ffmpeg', KEY, 'ffmpeg'))
    expect(toolPath('ffmpeg', join(scratch, 'out', 'main'))).toBe(join(scratch, 'vendor', 'ffmpeg', KEY, 'ffmpeg'))
  })

  it('says how to fetch it when it is not there, rather than failing at the first export', () => {
    scratch = mkdtempSync(join(tmpdir(), 'talkie-media-'))

    expect(() => toolPath('ffprobe', scratch!)).toThrow(/scripts\/fetchFfmpeg\.mjs --ensure/)
  })

  it('knows a packaged build by its archive, and a checkout by its absence', () => {
    expect(packagedResources('/A/Talkie.app/Contents/Resources/app.asar/out/main')).toBe('/A/Talkie.app/Contents/Resources')
    expect(packagedResources('/Users/someone/talkie/out/main')).toBeNull()
  })

  it('finds this checkout’s own copy', () => {
    expect(ffmpegPath()).toContain(join('vendor', 'ffmpeg', KEY, 'ffmpeg'))
    expect(ffprobePath()).toContain(join('vendor', 'ffmpeg', KEY, 'ffprobe'))
  })
})
