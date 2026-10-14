import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

/**
 * Remotion is gone, and stays gone.
 *
 * Talkie drew and exported its videos with Remotion, which is source-available rather than open
 * source; it now does both with its own renderer (docs/superpowers/specs/2026-10-13-own-renderer-
 * design.md). One convenient import would bring the package and its licence back without anything
 * failing, so this reads the sources — tests and mocks included, since a test mocking `remotion` is
 * testing against something nothing imports — and the dependencies.
 */
const ROOT = join(__dirname, '..', '..')
const SCANNED = ['src', 'scripts', 'e2e', join('examples', 'build')]

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

describe('Remotion', () => {
  it('would be found if it came back, so a pattern that matches nothing cannot pass', () => {
    const sample = [
      "import { useCurrentFrame } from 'remotion'",
      "import type { PlayerRef } from '@remotion/player'",
      "vi.mock('@remotion/renderer', () => ({}))",
      "const { bundle } = await import('@remotion/bundler')"
    ].join('\n')

    expect(specifiers(sample).filter(isRemotion)).toEqual(['remotion', '@remotion/player', '@remotion/renderer', '@remotion/bundler'])
  })

  it('is imported or mocked nowhere', () => {
    const offenders = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .map((file) => relative(ROOT, file))
      // This file spells them out above, to prove they would be found.
      .filter((file) => file !== relative(ROOT, __filename))
      .flatMap((file) =>
        specifiers(readFileSync(join(ROOT, file), 'utf-8'))
          .filter(isRemotion)
          .map((specifier) => `${file} imports ${specifier}`)
      )

    expect(offenders).toEqual([])
  })

  it('is not a dependency', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as Record<string, Record<string, string> | undefined>
    const declared = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) => Object.keys(pkg[field] ?? {}))

    expect(declared.filter(isRemotion)).toEqual([])
  })
})
