import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { arch, cpus, homedir, release, tmpdir, totalmem } from 'os'
import { join } from 'path'
import type { Settings } from '../settings/schema'
import { readSettings } from '../settings/settingsStore'
import { readLogTail } from './log'
import { scrub } from './scrub'
import { readBuildInfo } from './buildInfo'
import { formatChecks, type DoctorCheck } from './doctor'

export const REPOSITORY = 'https://github.com/murthy-chelankuri/talkie'

/** How much of the log goes in a report: enough to cover a session, small enough to read. */
const LOG_LINES = 1500

/**
 * The settings a report may carry, copied field by field.
 *
 * An allowlist, never a copy with the secrets deleted: settings hold API keys, and a field added
 * later must stay out of reports until someone decides it belongs. Where a value is private — a
 * key, a local model's address — the report says only whether it is set.
 */
export function settingsSummary(settings: Settings): Record<string, unknown> {
  const { narration, speech, recording, mcp } = settings
  return {
    narration: {
      provider: narration.provider,
      autoDraft: narration.autoDraft,
      claudeCliModel: narration.claudeCli.model || 'default',
      copilotCliModel: narration.copilotCli.model || 'default',
      anthropicModel: narration.anthropic.model,
      anthropicKeySet: Boolean(narration.anthropic.apiKey),
      localModelSet: Boolean(narration.local.model),
      localAddressSet: Boolean(narration.local.baseUrl)
    },
    speech: { engine: speech.engine, voice: speech.voice, pace: speech.pace },
    recording: { highlight: recording.highlight, allowUntrustedCertificates: recording.allowUntrustedCertificates },
    export: { burnCaptions: settings.export.burnCaptions },
    mcp: { enabled: mcp.enabled, tokenMade: Boolean(mcp.tokenHash) }
  }
}

function macosVersion(): string {
  try {
    return execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()
  } catch {
    return `Darwin ${release()}`
  }
}

/** What this copy of Talkie is and what it runs on — nothing about the person. */
export function aboutThisCopy(fromDir: string = __dirname): Record<string, unknown> {
  const build = readBuildInfo(fromDir)
  return {
    talkie: build ? { version: build.version, commit: build.commit, dirty: build.dirty, builtAt: build.builtAt } : 'unknown',
    macOS: macosVersion(),
    chip: cpus()[0]?.model ?? arch(),
    arch: arch(),
    memoryGB: Math.round(totalmem() / 2 ** 30),
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    chrome: process.versions.chrome ?? null
  }
}

export interface ProblemReport {
  /** Markdown, for the issue's body: short enough for a link, and readable without the zip. */
  summary: string
  /** What the zip holds, by file name. */
  files: Record<string, string>
}

export interface ReportInput {
  /** What the person says went wrong, in their words. */
  description: string
  checks: DoctorCheck[]
  baseDir?: string
  fromDir?: string
}

/**
 * A report on this copy of Talkie: what it is, what it runs on, its settings with nothing private,
 * the checks, and the end of the log. Never anything from a project — every text goes through
 * scrub() on its way in.
 */
export function gatherReport({ description, checks, baseDir = homedir(), fromDir = __dirname }: ReportInput): ProblemReport {
  const clean = (text: string): string => scrub(text, homedir())
  const about = aboutThisCopy(fromDir)
  const settings = settingsSummary(readSettings(baseDir))
  const failing = checks.filter((check) => check.ok === false)
  const log = clean(readLogTail(LOG_LINES, baseDir))
  const recentFailures = log
    .split('\n')
    .filter((line) => /fail|error|could not|stopped/i.test(line))
    .slice(-8)

  const summary = [
    '## What happened',
    '',
    description.trim() || '_Not described._',
    '',
    '## This copy of Talkie',
    '',
    '```json',
    JSON.stringify(about, null, 2),
    '```',
    '',
    '## Checks',
    '',
    failing.length === 0 ? 'Every check passed.' : `${failing.length} failed:`,
    '',
    '```',
    clean(formatChecks(checks)),
    '```',
    ...(recentFailures.length > 0 ? ['', '## Recent failures in the log', '', '```', ...recentFailures.map((line) => line.slice(0, 300)), '```'] : []),
    '',
    '_The full report — settings without secrets, and the end of the log — is in the attached zip._'
  ].join('\n')

  return {
    summary,
    files: {
      'README.txt': [
        'A Talkie problem report.',
        '',
        'It describes this copy of Talkie and the Mac it runs on. It holds nothing from any project —',
        'no narration, scene text, recordings or project names — and no API keys or tokens.',
        '',
        'summary.md      what happened, versions and the checks',
        'about.json      Talkie, macOS and the chip',
        'settings.json   settings, with private values given only as set or not set',
        'checks.json     every check, with what to do',
        'talkie.log      the end of the log'
      ].join('\n'),
      'summary.md': summary,
      'about.json': JSON.stringify(about, null, 2),
      'settings.json': JSON.stringify(settings, null, 2),
      'checks.json': clean(JSON.stringify(checks, null, 2)),
      'talkie.log': log
    }
  }
}

/** An address that opens a new issue with the summary filled in. Long ones are cut: links have a limit. */
export function issueUrl(report: ProblemReport, title: string): string {
  const body = report.summary.length > 6000 ? `${report.summary.slice(0, 6000)}\n\n_…cut short; the rest is in the zip._` : report.summary
  return `${REPOSITORY}/issues/new?${new URLSearchParams({ title, body }).toString()}`
}

/** The report as a zip, with ditto — on every Mac, so nothing is added to make one. */
export function writeReportZip(report: ProblemReport, destination: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-report-'))
  const folder = join(dir, 'Talkie report')
  try {
    mkdirSync(folder)
    for (const [name, text] of Object.entries(report.files)) writeFileSync(join(folder, name), text)
    execFileSync('ditto', ['-c', '-k', '--keepParent', folder, destination])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
