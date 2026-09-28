import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { claudeCliProvider } from './claudeCliProvider'
import { SettingsSchema } from '../settings/schema'

// findCli falls back to Homebrew's directories when PATH has nothing, and this machine has the
// real `claude` installed there. Mocking keeps this test from ever reaching it.
vi.mock('./findCli', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./findCli')>()
  return { findCli: vi.fn(actual.findCli) }
})

// claudeCliProvider reads settings with no base directory to override — the same as the
// Anthropic provider does — so the only way to hand it a model choice without touching the real
// ~/Talkie/settings.json on whatever machine runs this test is to mock the store outright.
vi.mock('../settings/settingsStore', () => ({ readSettings: vi.fn() }))

/**
 * Settings has no way to name a full Claude model — the CLI resolves aliases itself and there is
 * no API to check a full name against — so this checks the one thing Talkie is responsible for:
 * the chosen alias reaches the CLI's `--model` flag, and an unset one is left for the CLI's own
 * default rather than being forced onto the command line as an empty string.
 */
describe('the model chosen for the Claude CLI', () => {
  let binDir: string
  const originalPath = process.env.PATH

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), 'talkie-claude-model-'))
    process.env.PATH = binDir

    const path = join(binDir, 'claude')
    writeFileSync(
      path,
      `#!/bin/sh\nprintf '%s\\0' "$@" > "${join(binDir, 'args.txt')}"\necho '{"result":"done"}'\n`
    )
    chmodSync(path, 0o755)
  })

  afterEach(() => {
    process.env.PATH = originalPath
    rmSync(binDir, { recursive: true, force: true })
  })

  function recordedArgs(): string[] {
    const path = join(binDir, 'args.txt')
    return existsSync(path) ? readFileSync(path, 'utf8').split('\0').filter(Boolean) : []
  }

  async function withModel(model: string): Promise<void> {
    const { readSettings } = await import('../settings/settingsStore')
    vi.mocked(readSettings).mockReturnValue(
      SettingsSchema.parse({ narration: { claudeCli: { model } } })
    )
  }

  it('passes the chosen alias as --model', async () => {
    await withModel('opus')

    await claudeCliProvider.complete!('say hi')

    const args = recordedArgs()
    expect(args).toContain('--model')
    expect(args[args.indexOf('--model') + 1]).toBe('opus')
  })

  it('leaves --model out entirely when left on Default', async () => {
    await withModel('')

    await claudeCliProvider.complete!('say hi')

    expect(recordedArgs()).not.toContain('--model')
  })
})
