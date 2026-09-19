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
    const running = execFileAsync(
      binary,
      ['-p', prompt, '--output-format', 'json', '--allowedTools', 'Read'],
      { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
    )

    // Closed at once. The prompt is an argument, so nothing is ever written to stdin — but
    // `execFile` hands the child an open pipe anyway, and the CLI waits three seconds for
    // input that is not coming before warning and carrying on. One draft could afford that; a
    // walk of the app asks a question per step and pays it every time.
    running.child.stdin?.end()

    const { stdout } = await running
    return extractResult(stdout)
  } catch (err) {
    throw new Error(`The claude CLI could not answer: ${whatWentWrong(err)}`)
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

/**
 * What the CLI said, rather than what was asked of it.
 *
 * `execFile` builds its message from the command line, and the command line here is the whole
 * prompt — so a failure arrived as several hundred words of the question quoted back, with the
 * reason nowhere in it. The CLI puts the reason on stderr, which is where "usage limit
 * reached" and "not logged in" actually live.
 */
export function whatWentWrong(err: unknown): string {
  const stderr = (err as { stderr?: string } | null)?.stderr?.trim()
  if (stderr) {
    // Its warnings are chatter; the last real line is the complaint.
    const said = stderr
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !/^warning:/i.test(line))
    if (said.length > 0) return said[said.length - 1]
  }

  const message = messageOf(err)
  // Nothing useful on stderr: say the command failed without quoting the prompt back.
  if (/^Command failed:/.test(message)) {
    const timedOut = (err as { killed?: boolean } | null)?.killed
    return timedOut ? 'it took too long to answer' : 'it exited without answering'
  }
  return message
}
