import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { updateSettings } from '../../../src/main/settings/settingsStore'
import { kokoroCacheDir } from '../../../src/main/tts/kokoro/kokoroModel'
import { findCli } from '../../../src/main/agent/findCli'
import { listShippedExamples } from '../../../src/main/examples/installExamples'
import { EXAMPLE_VOICE } from '../kit'

/**
 * A home folder for filming the tour: Talkie as someone would have it set up, and nothing of the
 * person's own — their projects, and their settings, which hold API keys.
 *
 * - The examples are marked as already installed, so the tour opens on an empty browser.
 * - Kokoro's model and Playwright's browsers are borrowed from the copies already downloaded.
 * - Drafting and the agent go through the Claude CLI, which keeps its login in the macOS keychain
 *   under the real home. A `claude` placed first on PATH runs the real one with HOME put back for
 *   it alone. Talkie's own MCP server, which the agent starts, is given this home separately
 *   (TALKIE_HOME), so the agent still works on the tour's project and nowhere else.
 */
export async function tourHome(): Promise<{ home: string; env: Record<string, string>; dispose: () => void }> {
  const home = mkdtempSync(join(tmpdir(), 'talkie-tour-'))

  updateSettings(
    {
      speech: { engine: 'kokoro', voice: EXAMPLE_VOICE },
      narration: { autoDraft: false, provider: 'claude-cli' }
    },
    home
  )
  symlinkSync(kokoroCacheDir(homedir()), kokoroCacheDir(home))

  const browsers = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  if (existsSync(browsers)) {
    mkdirSync(join(home, 'Library', 'Caches'), { recursive: true })
    symlinkSync(browsers, join(home, 'Library', 'Caches', 'ms-playwright'))
  }

  writeFileSync(
    join(home, 'Talkie', 'examples.json'),
    JSON.stringify({ installed: Object.fromEntries(listShippedExamples().map((example) => [example.id, example.version])) })
  )

  const claude = await findCli('claude')
  if (!claude) throw new Error('The tour drafts with the Claude CLI, and there is no `claude` on this machine.')
  const bin = join(home, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nHOME='${homedir()}' exec '${claude}' "$@"\n`)
  chmodSync(join(bin, 'claude'), 0o755)

  return {
    home,
    env: { PATH: `${bin}:${process.env.PATH ?? ''}` },
    dispose: () => rmSync(home, { recursive: true, force: true })
  }
}
