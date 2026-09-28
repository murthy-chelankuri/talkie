import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { copilotCliProvider } from './copilotCliProvider'
import { findCli } from './findCli'
import type { NarrationRequest } from './narrationProvider'

// findCli falls back to Homebrew's directories when PATH has nothing, so on a machine that has
// the real CLI installed there — as testing the fix for projectAgent.ts requires — "nowhere on
// the machine" cannot be staged through PATH alone. Only that one test overrides the mock; every
// other call here forwards to the real implementation, which is what finds the fakes below.
vi.mock('./findCli', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./findCli')>()
  return { findCli: vi.fn(actual.findCli) }
})

/**
 * Tested against a stand-in binary rather than the real CLI, which needs a Copilot subscription
 * and a network. What is actually being checked is ours: that the command is found, that the
 * arguments spell out a read-only run, and that a failure reaches the user as something they can
 * act on rather than as an exit code.
 */
let binDir: string
const originalPath = process.env.PATH

function installFakeCopilot(script: string): void {
  const path = join(binDir, 'copilot')
  writeFileSync(path, `#!/bin/sh\n${script}\n`)
  chmodSync(path, 0o755)
}

/** Every argument the fake was called with. NUL-separated: the prompt spans many lines. */
function recordedArgs(): string[] {
  const path = join(binDir, 'args.txt')
  return existsSync(path) ? readFileSync(path, 'utf8').split('\0').filter(Boolean) : []
}


function request(overrides: Partial<NarrationRequest['evidence']> = {}): NarrationRequest {
  return {
    projectName: 'Talkie',
    clipIndex: 1,
    clipCount: 1,
    evidence: {
      kind: 'video',
      durationSeconds: 6,
      actions: [],
      framePaths: [],
      ...overrides
    }
  } as NarrationRequest
}

describe('the Copilot CLI provider', () => {
  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), 'talkie-copilot-'))
    process.env.PATH = binDir
  })

  afterEach(() => {
    process.env.PATH = originalPath
    rmSync(binDir, { recursive: true, force: true })
  })

  it('reports what to install when the command is nowhere on the machine', async () => {
    vi.mocked(findCli).mockResolvedValueOnce(null)

    const availability = await copilotCliProvider.isAvailable()

    expect(availability.available).toBe(false)
    expect(availability.reason).toContain('npm install -g @github/copilot')
  })

  it('finds the command and reports itself ready', async () => {
    installFakeCopilot('echo "1.0.0"')

    expect(await copilotCliProvider.isAvailable()).toMatchObject({ available: true })
  })

  it('stays available when the command is installed but has no --version', async () => {
    // Being unable to answer one flag is not the same as not being installed, and calling it
    // missing would send the user off to reinstall something they already have.
    installFakeCopilot('exit 1')

    expect(await copilotCliProvider.isAvailable()).toMatchObject({ available: true })
  })

  it('asks for one answer and nothing else around it', async () => {
    installFakeCopilot(`printf '%s\\0' "$@" > "${join(binDir, 'args.txt')}"\necho "Here is what happens."`)

    await copilotCliProvider.draft(request())

    const args = recordedArgs()
    expect(args).toContain('-p')
    expect(args).toContain('-s')
    expect(args).toContain('--no-ask-user')
  })

  it('refuses the tools that could change anything', async () => {
    installFakeCopilot(`printf '%s\\0' "$@" > "${join(binDir, 'args.txt')}"\necho "words"`)

    await copilotCliProvider.draft(request())

    expect(recordedArgs()).toContain('--deny-tool=shell')
    expect(recordedArgs()).toContain('--deny-tool=write')
  })

  it('allows reading only when there are frames to read', async () => {
    installFakeCopilot(`printf '%s\\0' "$@" > "${join(binDir, 'args.txt')}"\necho "words"`)

    await copilotCliProvider.draft(request())
    expect(recordedArgs()).not.toContain('--allow-tool=read')

    await copilotCliProvider.draft(request({ framePaths: ['/tmp/frame-1.png'] }))
    expect(recordedArgs()).toContain('--allow-tool=read')
  })

  it('names the frames in the prompt, since the CLI reads them off disk', async () => {
    installFakeCopilot(`printf '%s\\0' "$@" > "${join(binDir, 'args.txt')}"\necho "words"`)

    await copilotCliProvider.draft(request({ framePaths: ['/tmp/frame-1.png', '/tmp/frame-2.png'] }))

    const prompt = recordedArgs()[recordedArgs().indexOf('-p') + 1]
    expect(prompt).toContain('/tmp/frame-1.png')
    expect(prompt).toContain('/tmp/frame-2.png')
  })

  it('returns the spoken words with the CLI’s wrapping taken off', async () => {
    installFakeCopilot('echo \'"Here is what happens."\'')

    expect(await copilotCliProvider.draft(request())).toBe('Here is what happens.')
  })

  it('tells a signed-out user to sign in, rather than reporting an exit code', async () => {
    installFakeCopilot('echo "Error: not authenticated with GitHub" >&2\nexit 1')

    await expect(copilotCliProvider.draft(request())).rejects.toThrow(/\/login/)
  })

  it('passes on whatever else the CLI complained about', async () => {
    installFakeCopilot('echo "unknown flag: --no-ask-user" >&2\nexit 2')

    await expect(copilotCliProvider.draft(request())).rejects.toThrow(/unknown flag/)
  })

  it('treats an empty answer as a failure rather than silent narration', async () => {
    installFakeCopilot('exit 0')

    await expect(copilotCliProvider.draft(request())).rejects.toThrow(/could not answer/)
  })

  it('answers a prompt that has nothing to do with narration', async () => {
    // This is what writing a slide or redrawing a diagram goes through.
    installFakeCopilot('echo "flowchart LR"')

    // Optional on the interface — the built-in provider has no model to ask.
    expect(copilotCliProvider.complete).toBeDefined()
    expect(await copilotCliProvider.complete?.('draw me a flow')).toBe('flowchart LR')
  })
})
