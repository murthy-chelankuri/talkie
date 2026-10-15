import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'

/**
 * Kokoro's phonemizer is Talkie's own build of eSpeak NG, and has to stay one that reads exactly
 * as the old one did.
 *
 * eSpeak NG is GPL-3.0, so shipping it means offering the source it was built from, and npm's
 * phonemizer could not say what that was. packages/phonemizer is the same wrapper around an
 * eSpeak NG built from a pinned commit (see its BUILD.md). Two things would quietly undo that:
 * an install that resolves `phonemizer` from the registry again, which nothing else would
 * notice, and a build that phonemizes differently, which only a listener would — every voice
 * would sound slightly off, with no error anywhere.
 */
const ROOT = join(__dirname, '..', '..', '..', '..')
const PACKAGE = join(ROOT, 'packages', 'phonemizer')

type Phonemizer = { phonemize: (text: string, language?: string) => Promise<string[]> }

const expected = JSON.parse(readFileSync(join(PACKAGE, 'test', 'expected.json'), 'utf-8')) as {
  capturedFrom: string
  cases: { voice: string; text: string; phonemes: string[] }[]
}

const entries: [string, () => Promise<Phonemizer>][] = [
  // The one the app uses: the Kokoro worker is CommonJS, so kokoro-js and phonemizer are require()d.
  ['require()', async () => createRequire(__filename)(join(PACKAGE, 'dist', 'phonemizer.cjs')) as Phonemizer],
  ['import', async () => (await import(join(PACKAGE, 'src', 'phonemizer.js'))) as Phonemizer]
]

describe('Talkie’s build of eSpeak NG', () => {
  it('has something to compare against, in both voices', () => {
    expect(expected.capturedFrom).toBe('phonemizer 1.2.1 from npm')
    expect(new Set(expected.cases.map((each) => each.voice))).toEqual(new Set(['en-us', 'en']))
    expect(expected.cases.length).toBeGreaterThan(100)
  })

  for (const [how, load] of entries) {
    it(`reads every line exactly as npm’s phonemizer did, loaded with ${how}`, async () => {
      const { phonemize } = await load()
      const differing: string[] = []
      for (const { voice, text, phonemes } of expected.cases) {
        const got = await phonemize(text, voice)
        if (JSON.stringify(got) !== JSON.stringify(phonemes)) differing.push(`${voice}: ${text}\n  got  ${got.join(' | ')}\n  want ${phonemes.join(' | ')}`)
      }

      expect(differing).toEqual([])
    }, 60_000)
  }

  it('is a worker an ES module can load, with no require() left in it', () => {
    const worker = readFileSync(join(PACKAGE, 'src', 'espeakng.worker.js'), 'utf-8')

    expect(worker).not.toMatch(/\brequire\(/)
    expect(worker.trimEnd().endsWith('export default Module;')).toBe(true)
  })
})

describe('where phonemizer comes from', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf-8'))

  it('is the package in this repository, for kokoro-js too', () => {
    expect(pkg.dependencies.phonemizer).toBe('file:packages/phonemizer')
    expect(pkg.overrides.phonemizer).toBe('$phonemizer')
  })

  it('is locked to that package, so a clean install never fetches npm’s', () => {
    expect(lock.packages['node_modules/phonemizer']).toEqual({ resolved: 'packages/phonemizer', link: true })
    expect(JSON.stringify(lock)).not.toContain('registry.npmjs.org/phonemizer/')
  })

  it('says what it is under, and what it was built from', () => {
    const own = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf-8'))
    const build = readFileSync(join(PACKAGE, 'BUILD.md'), 'utf-8')
    const script = readFileSync(join(PACKAGE, 'build', 'build.sh'), 'utf-8')
    const commit = script.match(/^COMMIT=([0-9a-f]{40})$/m)?.[1]
    const archive = script.match(/^ARCHIVE_SHA256=([0-9a-f]{64})$/m)?.[1]

    expect(own.license).toBe('Apache-2.0 AND GPL-3.0-or-later')
    expect(readFileSync(join(PACKAGE, 'COPYING'), 'utf-8')).toContain('Version 3, 29 June 2007')
    expect(readFileSync(join(PACKAGE, 'LICENSE'), 'utf-8')).toContain('Apache License')
    // The script is what builds it and BUILD.md is what a recipient reads; they name one source.
    expect(commit).toBeDefined()
    expect(archive).toBeDefined()
    expect(build).toContain(commit!)
    expect(build).toContain(archive!)
  })

  it('is the only eSpeak NG the app ships — kokoro-js carries a copy of the old one for browsers', () => {
    // kokoro.web.js bundles npm's phonemizer whole. Node never loads it, but it was in the
    // archive all the same: a GPL binary with no known source, shipped by accident.
    const config = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf-8')

    expect(config).toContain("'!node_modules/kokoro-js/dist/kokoro.web.js'")
  })
})
