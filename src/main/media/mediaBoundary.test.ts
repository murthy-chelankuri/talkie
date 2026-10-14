import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

/**
 * ffmpeg and ffprobe are reached through src/main/media and nowhere else.
 *
 * They are native binaries whose location differs between a checkout and a packaged build, whose
 * licence depends on which encoders are asked for, and whose Windows and Linux builds arrive
 * with project 2. Each of those used to be every call site's problem: the getVideoMetadata call
 * that was never told where the binaries were worked in a checkout and cut every packaged
 * recording to three seconds. Read off the source, tests included, because one convenient
 * direct call works perfectly everywhere the suite looks.
 */
const ROOT = join(__dirname, '..', '..', '..')
const SCANNED = ['src', 'scripts', 'e2e', join('examples', 'build')]
const MEDIA = join('src', 'main', 'media') + sep

const FORBIDDEN: { what: string; pattern: RegExp }[] = [
  { what: "a third-party renderer's ffmpeg wrapper", pattern: /RenderInternals\.callFf|callFfNative|getVideoMetadata\s*\(/ },
  { what: 'a spawn of ffmpeg by name', pattern: /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|execa)\s*\(\s*['"`]ff(?:mpeg|probe)\b/ },
  { what: 'a path built to an ffmpeg binary', pattern: /\bjoin\s*\([^)]*['"`]ff(?:mpeg|probe)(?:\.exe)?['"`]\s*\)/ },
  { what: 'an ffmpeg binary package', pattern: /['"](?:ffmpeg-static|ffprobe-static|@ffmpeg-installer\/[^'"]+|@ffprobe-installer\/[^'"]+)['"]/ }
]

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.(ts|tsx|mjs|js|cjs)$/.test(entry)) found.push(path)
  }
  return found
}

describe('the line around ffmpeg', () => {
  it('finds the media module building its own path, so a pattern that matches nothing cannot pass', () => {
    const own = readFileSync(join(ROOT, 'src', 'main', 'media', 'run.ts'), 'utf-8')
    expect(/execFile\(toolPath/.test(own)).toBe(true)
  })

  it('lets nothing outside src/main/media run ffmpeg or ffprobe its own way', () => {
    const offenders = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .map((file) => relative(ROOT, file))
      .filter((file) => !file.startsWith(MEDIA))
      .flatMap((file) => {
        const source = readFileSync(join(ROOT, file), 'utf-8')
        return FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(({ what }) => `${file} uses ${what}`)
      })

    expect(offenders).toEqual([])
  })
})
