import { existsSync, mkdtempSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { readSettings } from '../settings/settingsStore'
import { workerPath } from '../tts/kokoro/kokoroProcess'
import { isKokoroDownloaded } from '../tts/kokoro/kokoroModel'
import { speechEngine } from '../tts/engineRegistry'
import { DEFAULT_KOKORO_VOICE, isKokoroVoiceName } from '../tts/kokoroTtsProvider'
import { toolPath } from '../media'
import { browserExecutablePath } from '../capture/resolveBrowser'
import { checkoutCommit, readBuildInfo } from './buildInfo'

/**
 * Whether this copy of Talkie can do its work, checked part by part, each with what to do.
 *
 * One list for everyone who asks: `npm run doctor` in a terminal, the problem report, and an agent
 * through talkie_diagnostics. The failure that shaped it said only "Kokoro stopped unexpectedly
 * (exit code 1)", on another Mac, and every question that would have found the cause — was it
 * rebuilt after the pull, is the worker there, is the voice downloaded — had to be asked by hand.
 */
export interface DoctorCheck {
  id: string
  label: string
  /** null is a note, neither working nor broken. */
  ok: boolean | null
  detail: string
  /** What to do, when it is not ok. */
  fix?: string
}

export interface DoctorOptions {
  baseDir?: string
  /** Where the running code is, for finding what was built beside it. */
  fromDir?: string
  /** Also speak a line in the chosen voice — seconds, not milliseconds, so only when asked. */
  speak?: boolean
}

export async function runDoctor({ baseDir = homedir(), fromDir = __dirname, speak = false }: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const checks = [checkBuild(fromDir), checkNode(), checkWorker(fromDir), checkVoice(baseDir), checkMedia(fromDir), checkBrowser(), checkMcp(baseDir)]
  if (speak) checks.push(await checkSpeaking(baseDir))
  return checks
}

const short = (commit: string): string => commit.slice(0, 7)

export function checkBuild(fromDir: string = __dirname, head: string | null = checkoutCommit(fromDir)): DoctorCheck {
  const info = readBuildInfo(fromDir)
  const base = { id: 'build', label: 'Build' }
  if (!info) {
    return head
      ? { ...base, ok: false, detail: 'This checkout has not been built, or was built before builds were recorded.', fix: 'Run `npm run build`.' }
      : { ...base, ok: null, detail: 'No record of the build.' }
  }
  const built = info.commit ? `${info.version}, built from ${short(info.commit)}${info.dirty ? ' with uncommitted changes' : ''} at ${info.builtAt}` : `${info.version}, built at ${info.builtAt}`
  if (head && info.commit && head !== info.commit) {
    return {
      ...base,
      ok: false,
      detail: `Built from ${short(info.commit)}, but the checkout is at ${short(head)}: what runs is the older code.`,
      fix: 'Run `npm run build`, then restart Talkie and any agent using its MCP server.'
    }
  }
  return { ...base, ok: true, detail: built }
}

function checkNode(): DoctorCheck {
  const major = Number(process.versions.node.split('.')[0])
  const electron = process.versions.electron ? `, inside Electron ${process.versions.electron}` : ''
  return major >= 20
    ? { id: 'node', label: 'Node', ok: true, detail: `${process.versions.node}${electron}` }
    : { id: 'node', label: 'Node', ok: false, detail: `${process.versions.node} is too old.`, fix: 'Install Node 20 or newer.' }
}

function checkWorker(fromDir: string): DoctorCheck {
  const path = workerPath(fromDir)
  return existsSync(path)
    ? { id: 'kokoro-worker', label: 'Kokoro worker', ok: true, detail: 'Found.' }
    : { id: 'kokoro-worker', label: 'Kokoro worker', ok: false, detail: 'Not built, so the Kokoro voice cannot start.', fix: 'Run `npm run build`.' }
}

function checkVoice(baseDir: string): DoctorCheck {
  const { speech } = readSettings(baseDir)
  const base = { id: 'voice', label: 'Narration voice' }
  if (speech.engine !== 'kokoro') return { ...base, ok: true, detail: `macOS voice ${speech.voice}` }
  // A voice left over from the Mac's engine is read in Kokoro's default, without a word — which
  // sounds like the setting being ignored.
  const voice = isKokoroVoiceName(speech.voice) ? speech.voice : `${DEFAULT_KOKORO_VOICE} (the voice set, ${speech.voice}, is not a Kokoro voice)`
  return isKokoroDownloaded(baseDir)
    ? { ...base, ok: true, detail: `Kokoro, ${voice}; the voice is downloaded.` }
    : { ...base, ok: false, detail: `Kokoro, ${voice}; the voice is not downloaded.`, fix: 'Download it in Talkie, under Settings → Narration.' }
}

function checkMedia(fromDir: string): DoctorCheck {
  const missing = (['ffmpeg', 'ffprobe'] as const).filter((tool) => !existsSync(toolPath(tool, fromDir)))
  return missing.length === 0
    ? { id: 'media', label: 'Video tools', ok: true, detail: 'ffmpeg and ffprobe found.' }
    : { id: 'media', label: 'Video tools', ok: false, detail: `${missing.join(' and ')} missing.`, fix: 'Run `node scripts/fetchFfmpeg.mjs --ensure` in the checkout, or reinstall the app.' }
}

function checkBrowser(): DoctorCheck {
  return browserExecutablePath()
    ? { id: 'browser', label: 'Browser', ok: true, detail: 'Found, for recording and export.' }
    : { id: 'browser', label: 'Browser', ok: false, detail: 'None found.', fix: 'Install Google Chrome, or run `npx playwright install chromium`.' }
}

function checkMcp(baseDir: string): DoctorCheck {
  const { mcp } = readSettings(baseDir)
  const token = mcp.tokenHash ? 'a token has been made' : 'no token has been made'
  return { id: 'mcp', label: 'Agent access (MCP)', ok: null, detail: `${mcp.enabled ? 'On' : 'Off'}; ${token}.` }
}

/** The same call narration makes, with a line of its own, so a pass here means narration works. */
async function checkSpeaking(baseDir: string): Promise<DoctorCheck> {
  const { speech } = readSettings(baseDir)
  const dir = mkdtempSync(join(tmpdir(), 'talkie-doctor-'))
  const base = { id: 'speaking', label: 'Speaking a line' }
  try {
    await speechEngine(speech.engine).synthesize('Talkie can speak.', join(dir, 'line.wav'), speech)
    return { ...base, ok: true, detail: `Spoke a line in ${speech.engine === 'kokoro' ? 'Kokoro' : 'the macOS voice'}.` }
  } catch (err) {
    return { ...base, ok: false, detail: err instanceof Error ? err.message : String(err), fix: 'Send this report: the line above is what went wrong.' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The checks as lines of text, for a terminal or an agent. */
export function formatChecks(checks: DoctorCheck[]): string {
  return checks
    .map((check) => {
      const mark = check.ok === true ? '✓' : check.ok === false ? '✗' : '·'
      return `${mark} ${check.label}: ${check.detail}${check.fix ? `\n    → ${check.fix}` : ''}`
    })
    .join('\n')
}
