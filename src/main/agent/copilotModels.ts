import { execFile } from 'child_process'
import { promisify } from 'util'
import { findCli } from './findCli'

const execFileAsync = promisify(execFile)
const HELP_TIMEOUT_MS = 15_000

/**
 * The model ids Copilot CLI can be asked for, read off its own `help config` text.
 *
 * There is no API for this — the catalogue changes as GitHub adds and retires models, and the
 * CLI is the only thing that keeps up. It does not say which of them this particular account can
 * actually use, though: `mai-code-1.1-flash`, the one a Free-plan account was seen routing to
 * under `auto`, was refused when asked for by name on that same account. Explicit selection
 * appears to be gated to a paid plan; a name off this list still has to be tried to find out.
 */
export async function listCopilotModels(): Promise<string[]> {
  const binary = await findCli('copilot')
  if (!binary) return []

  try {
    const { stdout } = await execFileAsync(binary, ['help', 'config'], { timeout: HELP_TIMEOUT_MS })
    return parseModelList(stdout)
  } catch {
    return []
  }
}

/**
 * `help config` documents every setting as a backtick-quoted key followed by prose and, for
 * `model`, an indented, quoted list — the only place this catalogue exists in a form a program
 * can read. Reading it this way breaks the moment that formatting changes rather than the moment
 * a model is renamed, which is why a change here returns nothing rather than a wrong list.
 */
export function parseModelList(helpText: string): string[] {
  const lines = helpText.split('\n')
  const start = lines.findIndex((line) => /^\s*`model`:/.test(line))
  if (start === -1) return []

  const models: string[] = []
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^\s*-\s*"([^"]+)"/)
    if (!match) break
    models.push(match[1])
  }
  return models
}
