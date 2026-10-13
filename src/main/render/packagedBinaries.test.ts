import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Everything that shells out has to be told where the binaries are.
 *
 * Remotion looks for ffmpeg and ffprobe beside its own package. That is right in a checkout and
 * wrong in a packaged build, where the code sits inside an asar archive and nothing can be
 * executed from in there — so `binariesDirectory()` exists to point at the copy electron-builder
 * unpacks. The catch is that forgetting it fails only when packaged, which is the one place the
 * suite never looked.
 *
 * `callFf` was passed it everywhere. `getVideoMetadata` was not, and measuring a recording is
 * how the import learns how long it is: the call threw, the three-second placeholder stood in
 * for the real length, and every scene was cut against that. A recording of any duration arrived
 * on the timeline as three seconds of its opening — for an app behind a login, the login and
 * nothing after it. It worked perfectly in `npm run dev` the whole time.
 *
 * Read off the source rather than executed, because the failure is a packaging one: running
 * these in the suite exercises the checkout layout, which is exactly the case that always worked.
 *
 * Talkie's own ffmpeg calls go through src/main/media, which finds its binaries from its own
 * folder (binaries.test.ts there). What is left here is Remotion's export, which still runs on
 * Remotion's compositor until step 3 of the renderer.
 */
const MAIN = join(__dirname, '..')

/** Remotion entry points that reach for a binary, and the file each is called from. */
const CALLS_A_BINARY = [
  { fn: 'selectComposition', file: 'render/remotionExport.ts' },
  { fn: 'renderMedia', file: 'render/remotionExport.ts' }
]

describe('shelling out from a packaged build', () => {
  it.each(CALLS_A_BINARY)('tells $fn in $file where the binaries are', ({ fn, file }) => {
    const source = readFileSync(join(MAIN, file), 'utf-8')
    const call = source.indexOf(`${fn}(`)

    expect(call, `${fn} is no longer called in ${file} — update this list`).toBeGreaterThan(-1)
    // Within the call itself, not merely somewhere in the file.
    expect(source.slice(call, call + 400)).toContain('binariesDirectory')
  })

  it('fetches ffmpeg before packaging, so a build never ships without it', () => {
    // electron-builder only logs an extraResources source that is missing and carries on, so
    // the packaged app would start and find nothing to record or speak with.
    const { scripts } = JSON.parse(readFileSync(join(MAIN, '..', '..', 'package.json'), 'utf-8'))

    expect(scripts.package).toMatch(/^node scripts\/fetchFfmpeg\.mjs --ensure &&/)
    expect(scripts['package:dir']).toMatch(/^node scripts\/fetchFfmpeg\.mjs --ensure &&/)
  })

  it('ships Talkie’s own ffmpeg outside the archive, where src/main/media looks for it', () => {
    const builder = readFileSync(join(MAIN, '..', '..', 'electron-builder.yml'), 'utf-8')
    // packagedResources() + 'ffmpeg' is where toolPath looks in a packaged build.
    expect(builder).toMatch(/- from: vendor\/ffmpeg\/\$\{platform\}-\$\{arch\}\s+to: ffmpeg/)
  })
})
