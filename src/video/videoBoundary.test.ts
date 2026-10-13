import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

/**
 * Remotion is reached through src/video and nowhere else.
 *
 * Talkie is replacing Remotion (docs/superpowers/specs/2026-10-13-own-renderer-design.md), and
 * that is only a change to one folder while every scene and every editor component goes through
 * it. One convenient direct import works perfectly and quietly makes the replacement a hunt
 * again, so this reads the sources, tests and mocks included: a test mocking `remotion` directly
 * is testing a scene against something it no longer imports.
 *
 * Remotion's export (@remotion/renderer, @remotion/bundler) is all that is left of it in the main
 * process, in src/main/render; step 3 replaces it.
 */
const ROOT = join(__dirname, '..', '..')
const SEAM = join('src', 'video') + sep
const SCANNED = ['src', 'scripts', 'e2e', join('examples', 'build')]

/** Export, still Remotion's until step 3, and kept to where it is used. */
const MAIN_PROCESS_ONLY = ['@remotion/renderer', '@remotion/bundler']
const MAIN_PROCESS_PLACES = [join('src', 'main', 'render') + sep, join('scripts') + sep]

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.(ts|tsx|mjs)$/.test(entry)) found.push(path)
  }
  return found
}

function specifiers(source: string): string[] {
  // `from 'x'`, a bare `import 'x'`, dynamic import and require, and every vitest way of reaching
  // a module (mock, doMock, importActual, importMock), with an optional type argument.
  const forms = /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*|vi\.(?:mock|doMock|importActual|importMock)\s*(?:<[^>]*>)?\(\s*)['"]([^'"]+)['"]/g
  return [...source.matchAll(forms)].map((match) => match[1])
}

const isRemotion = (specifier: string): boolean => specifier === 'remotion' || specifier.startsWith('remotion/') || specifier.startsWith('@remotion/')

describe('the line around Remotion', () => {
  it('finds src/video importing Remotion, so a regex that matched nothing cannot pass', () => {
    expect(specifiers(readFileSync(join(ROOT, 'src', 'video', 'clock.tsx'), 'utf-8'))).toContain('remotion')
    expect(specifiers(readFileSync(join(ROOT, 'src', 'video', 'preview.tsx'), 'utf-8'))).toContain('@remotion/player')
  })

  it('lets nothing outside src/video import or mock Remotion', () => {
    const offenders = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .map((file) => relative(ROOT, file))
      .filter((file) => !file.startsWith(SEAM))
      .flatMap((file) =>
        specifiers(readFileSync(join(ROOT, file), 'utf-8'))
          .filter(isRemotion)
          .filter((specifier) => !(MAIN_PROCESS_ONLY.includes(specifier) && MAIN_PROCESS_PLACES.some((place) => file.startsWith(place))))
          .map((specifier) => `${file} imports ${specifier}`)
      )

    expect(offenders).toEqual([])
  })
})
