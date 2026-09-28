import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listCopilotModels, parseModelList } from './copilotModels'
import { findCli } from './findCli'

// findCli falls back to Homebrew's directories when PATH has nothing, and this machine has the
// real `copilot` installed there. Only the "not installed" test below overrides the mock; every
// other call forwards to the real implementation, which is what finds the fake below.
vi.mock('./findCli', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./findCli')>()
  return { findCli: vi.fn(actual.findCli) }
})

/**
 * A real excerpt of `copilot help config`'s output (v1.0.88), trimmed to the parts that matter:
 * the model list sits between the `model` key and the next one, as a backtick key followed by an
 * indented, quoted list. Nothing else in the CLI documents this catalogue.
 */
const REAL_HELP_EXCERPT = `Configuration Settings:

  \`allowedUrls\`: list of URLs or domains that are allowed to be accessed without prompting.
    Supports exact URLs (e.g., "https://github.com").

  \`logLevel\`: log level for CLI; defaults to "default". Set to "all" for debug logging.

  \`model\`: AI model to use for Copilot CLI; can be changed with /model command or --model flag option.
    - "claude-sonnet-5"
    - "claude-fable-5.1"
    - "gpt-5.4"
    - "mai-code-1.1-flash"

  \`contextTier\`: context window tier for tiered-pricing models (e.g., "default" or "long_context").
    - Can also be set with --context flag (overrides persisted setting)
`

describe('reading the model list off the Copilot CLI', () => {
  it('reads the quoted list between the model key and the next one', () => {
    expect(parseModelList(REAL_HELP_EXCERPT)).toEqual([
      'claude-sonnet-5',
      'claude-fable-5.1',
      'gpt-5.4',
      'mai-code-1.1-flash'
    ])
  })

  it('returns nothing if the CLI stops documenting the list this way', () => {
    // A parser that guessed here would offer models that are not really an option, which is a
    // worse failure than an empty list falling back to Auto.
    expect(parseModelList('Configuration Settings:\n\n  `logLevel`: as above.\n')).toEqual([])
  })

  it('stops at the blank line rather than reading into the next setting', () => {
    const withoutABlankLine = REAL_HELP_EXCERPT.replace(
      '\n  `contextTier`',
      '  `contextTier`'
    )
    expect(parseModelList(withoutABlankLine)).toEqual([
      'claude-sonnet-5',
      'claude-fable-5.1',
      'gpt-5.4',
      'mai-code-1.1-flash'
    ])
  })

  describe('against a stand-in copilot', () => {
    let binDir: string
    const originalPath = process.env.PATH

    beforeEach(() => {
      binDir = mkdtempSync(join(tmpdir(), 'talkie-copilot-models-'))
      // The fake below uses `cat` to emit its canned output, and `cat` needs PATH to find it —
      // unlike `echo` and `printf`, which every other fake binary in this codebase uses because
      // they are shell builtins and need no PATH lookup at all.
      process.env.PATH = `${binDir}:/bin:/usr/bin`
    })

    afterEach(() => {
      process.env.PATH = originalPath
      rmSync(binDir, { recursive: true, force: true })
    })

    it('asks the CLI for its config help and parses the answer', async () => {
      writeFileSync(
        join(binDir, 'copilot'),
        `#!/bin/sh\nif [ "$1" = "help" ] && [ "$2" = "config" ]; then\ncat <<'EOF'\n${REAL_HELP_EXCERPT}\nEOF\nfi\n`
      )
      chmodSync(join(binDir, 'copilot'), 0o755)

      expect(await listCopilotModels()).toEqual([
        'claude-sonnet-5',
        'claude-fable-5.1',
        'gpt-5.4',
        'mai-code-1.1-flash'
      ])
    })

    it('says nothing is available when the command is not installed', async () => {
      vi.mocked(findCli).mockResolvedValueOnce(null)

      expect(await listCopilotModels()).toEqual([])
    })

    it('falls back to nothing rather than throwing when the CLI itself fails', async () => {
      writeFileSync(join(binDir, 'copilot'), '#!/bin/sh\nexit 1\n')
      chmodSync(join(binDir, 'copilot'), 0o755)

      expect(await listCopilotModels()).toEqual([])
    })
  })
})
