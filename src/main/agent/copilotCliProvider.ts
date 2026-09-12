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
const TIMEOUT_MS = 180_000

const INSTALL_HINT =
  'The `copilot` command was not found. Install it with `npm install -g @github/copilot` (Node 22 or later), then run `copilot` once and sign in with /login.'

/**
 * Narration from the GitHub Copilot CLI already installed and signed in on this machine.
 *
 * The same bargain as the Claude CLI provider: no API key to keep, no new dependency, and it
 * bills to the Copilot subscription the user already has. It is a second CLI rather than a
 * variation on the first because the two speak differently — Copilot answers as plain text on
 * stdout under `-s`, where `claude` is asked for JSON.
 *
 * Drafting narration is a read-only job, so the agent is given the one tool it needs to look at
 * the sampled frames and is explicitly denied the two that could change anything.
 */
export const copilotCliProvider: NarrationProvider = {
  id: 'copilot-cli',
  label: 'GitHub Copilot CLI',
  sendsDataOffMachine: true,

  async isAvailable(): Promise<ProviderAvailability> {
    const binary = await findCli('copilot')
    if (!binary) return { available: false, reason: INSTALL_HINT }

    try {
      await execFileAsync(binary, ['--version'], { timeout: 15_000 })
      return { available: true }
    } catch {
      // It is installed; --version simply did not answer. Whether it is signed in shows up when
      // a draft is asked for, and reporting it as missing here would be plainly wrong.
      return { available: true }
    }
  },

  async complete(prompt: string): Promise<string> {
    return cleanDraft(await runCopilot(prompt, []))
  },

  async draft(request: NarrationRequest): Promise<string> {
    const { framePaths } = request.evidence
    return cleanDraft(await runCopilot(withFrameInstructions(request), framePaths))
  }
}

async function runCopilot(prompt: string, framePaths: string[]): Promise<string> {
  const binary = await findCli('copilot')
  if (!binary) throw new Error(INSTALL_HINT)

  const args = [
    '-p',
    prompt,
    // Only the answer, with none of the stats and framing the CLI prints for a person.
    '-s',
    // Nothing is watching this run, so a question would hang until the timeout.
    '--no-ask-user',
    '--deny-tool=shell',
    '--deny-tool=write'
  ]

  // Reading is needed only when there are frames on disk to look at.
  if (framePaths.length > 0) args.push('--allow-tool=read')

  try {
    const { stdout } = await execFileAsync(binary, args, {
      timeout: TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024
    })

    const answer = stdout.trim()
    if (!answer) throw new Error('it returned nothing')
    return answer
  } catch (err) {
    throw new Error(`The Copilot CLI could not answer: ${describeFailure(err)}`)
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

/**
 * What the CLI said, not what the exit code was. A signed-out Copilot and a wrong flag both
 * exit non-zero, and only its own message tells them apart.
 */
function describeFailure(err: unknown): string {
  const stderr = (err as { stderr?: string })?.stderr?.trim()
  if (stderr) {
    if (/log ?in|sign ?in|unauthor|authenticat|credential/i.test(stderr)) {
      return `${firstLine(stderr)} — run \`copilot\` in a terminal and sign in with /login.`
    }
    return firstLine(stderr)
  }

  const message = err instanceof Error ? err.message : String(err)
  if ((err as { killed?: boolean })?.killed) {
    return `it did not finish within ${TIMEOUT_MS / 1000} seconds`
  }
  return message
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim())?.trim() ?? text
}
