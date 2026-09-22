import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..', '..')

/**
 * Catching an Electron install that never finished, before it looks like a broken app.
 *
 * The `electron` package is a stub and its binary is fetched by a postinstall. When that does
 * not happen — npm set not to run scripts, a download a proxy refused, an interrupted install —
 * the stub throws "Electron failed to install correctly" the moment `npm run dev` starts. It
 * reads as the app being broken rather than as an install that never finished, and the advice in
 * it names a repair rather than a cause. It has now cost two machines an afternoon.
 */
describe('starting up with an Electron that was never fully installed', () => {
  it('checks before trying to run it', () => {
    const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))

    expect(scripts.dev).toContain('ensureElectron')
  })

  it('checks from inside the dev script, not from a hook that can be switched off', () => {
    // The whole subtlety. `ignore-scripts` is the commonest cause of the failure, and it also
    // skips pre and post hooks — so a `predev` would be disabled by the very setting it exists
    // to catch. A script npm was asked for by name still runs.
    const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))

    expect(scripts.predev).toBeUndefined()
    expect(scripts.dev.indexOf('ensureElectron')).toBeLessThan(scripts.dev.indexOf('electron-vite'))
  })

  it('says nothing at all when the install is sound', () => {
    // It runs before every single `npm run dev`. A guard that printed on the way past would be
    // noise on the one path that is always taken.
    const output = execFileSync(process.execPath, [join(ROOT, 'scripts/ensureElectron.mjs')], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    })

    expect(output.trim()).toBe('')
  }, 60_000)

  it('names the causes rather than only the repair', () => {
    // What the stub's own message is missing: why it happened. Someone reading it should not
    // have to know that ignore-scripts and a blocked github.com are the two usual answers.
    const guard = readFileSync(join(ROOT, 'scripts/ensureElectron.mjs'), 'utf-8')

    expect(guard).toContain('ignore-scripts')
    expect(guard).toContain('ELECTRON_MIRROR')
    expect(guard).toContain('ELECTRON_SKIP_BINARY_DOWNLOAD')
  })
})
