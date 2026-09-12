import { execFile } from 'child_process'
import { promisify } from 'util'
import { findCli } from './findCli'
import {
  buildPrompt,
  cleanDraft,
  type NarrationProvider,
  type NarrationRequest,
  type ProviderAvailability
} from './narrationProvider'

const execFileAsync = promisify(execFile)

/** A draft is one short answer; anything longer than this has gone wrong. */
const TIMEOUT_MS = 120_000

/**
 * Narration from the `claude` CLI already installed and signed in on this machine.
 *
 * This mirrors how the TTS provider shells out to `say`: no new dependency, no API key to
 * manage, and it uses the account the user is already signed into. Frames are handed over as
 * file paths for the CLI to read, so drafting costs whatever that session costs.
 */
export const claudeCliProvider: NarrationProvider = {
  id: 'claude-cli',
  label: 'Claude CLI',
  sendsDataOffMachine: true,

  async isAvailable(): Promise<ProviderAvailability> {
    // Looked up rather than left to PATH: an app opened from Finder barely has one. See findCli.
    const binary = await findCli('claude')
    if (!binary) {
      return {
        available: false,
        reason: 'The `claude` command was not found. Install Claude Code and sign in, then try again.'
      }
    }

    try {
      await execFileAsync(binary, ['--version'], { timeout: 15_000 })
      return { available: true }
    } catch {
      // It is installed; whether it is signed in shows up when a draft is asked for.
      return { available: true }
    }
  },

  async complete(prompt: string): Promise<string> {
    return cleanDraft(await runClaude(prompt))
  },

  async draft(request: NarrationRequest): Promise<string> {
    const prompt = withFrameInstructions(request)

    return cleanDraft(await runClaude(prompt))
  }
}

async function runClaude(prompt: string): Promise<string> {
  const binary = await findCli('claude')
  if (!binary) throw new Error('The `claude` command was not found.')

  try {
    const { stdout } = await execFileAsync(
      binary,
      ['-p', prompt, '--output-format', 'json', '--allowedTools', 'Read'],
      { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
    )
    return extractResult(stdout)
  } catch (err) {
    throw new Error(`The claude CLI could not answer: ${messageOf(err)}`)
  }
}

function withFrameInstructions(request: NarrationRequest): string {
  const prompt = buildPrompt(request)
  if (request.evidence.framePaths.length === 0) return prompt

  // The CLI reads images from disk rather than receiving them inline.
  return [
    prompt,
    '',
    'Read these image files before writing, in this order:',
    ...request.evidence.framePaths.map((path) => `  ${path}`)
  ].join('\n')
}

function extractResult(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as { result?: unknown; is_error?: boolean }
    if (typeof parsed.result === 'string' && parsed.result.trim()) return parsed.result
    throw new Error('no result field in the CLI response')
  } catch (err) {
    // A CLI that changed its output shape should say so plainly rather than narrate its JSON.
    throw new Error(`Could not read the claude CLI response: ${messageOf(err)}`)
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
