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
 */
const MAIN = join(__dirname, '..')

/** Remotion entry points that reach for a binary, and the file each is called from. */
const CALLS_A_BINARY = [
  { fn: 'getVideoMetadata', file: 'capture/importRecordedSession.ts' },
  { fn: 'getVideoMetadata', file: 'transcript/fitToFootage.ts' },
  { fn: 'selectComposition', file: 'render/renderProject.ts' },
  { fn: 'renderMedia', file: 'render/renderProject.ts' }
]

describe('shelling out from a packaged build', () => {
  it.each(CALLS_A_BINARY)('tells $fn in $file where the binaries are', ({ fn, file }) => {
    const source = readFileSync(join(MAIN, file), 'utf-8')
    const call = source.indexOf(`${fn}(`)

    expect(call, `${fn} is no longer called in ${file} — update this list`).toBeGreaterThan(-1)
    // Within the call itself, not merely somewhere in the file.
    expect(source.slice(call, call + 400)).toContain('binariesDirectory')
  })

  it('leaves no callFf without it, which is how the rule was kept before', () => {
    // The original invariant, still worth pinning: every callFf spreads ffOptions().
    for (const file of [
      'capture/stitchRecording.ts',
      'transcript/recordNarration.ts',
      'setup/readiness.ts',
      'agent/clipEvidence.ts'
    ]) {
      const source = readFileSync(join(MAIN, file), 'utf-8')
      const calls = source.split('RenderInternals.callFf(').length - 1
      const told = source.split('...ffOptions()').length - 1

      expect(told, `${file} has ${calls} callFf calls but ${told} passing ffOptions()`).toBe(calls)
    }
  })
})
