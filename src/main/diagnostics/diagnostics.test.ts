import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scrub } from './scrub'
import { configureLog, logEvent, logFailure, logPath, readLogTail } from './log'
import { checkBuild, formatChecks, runDoctor, type DoctorCheck } from './doctor'
import { gatherReport, issueUrl, settingsSummary, writeReportZip } from './report'
import { SettingsSchema } from '../settings/schema'
import { updateSettings } from '../settings/settingsStore'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'talkie-diagnostics-'))
})

afterEach(() => {
  configureLog({ source: 'app' })
  rmSync(home, { recursive: true, force: true })
})

describe('taking what is private out of a report', () => {
  it('names the home folder as ~, and a project by its id, not its name', () => {
    expect(scrub('/Users/ada/Talkie/Projects/k3x9q2m7-acme-pricing-launch/audio/take.wav', '/Users/ada')).toBe(
      '~/Talkie/Projects/k3x9q2m7/audio/take.wav'
    )
  })

  it('takes out the words an error quotes, but keeps a quoted path', () => {
    const said = scrub('Kokoro read “Our pricing for Acme changes in March” as silence; "/Users/ada/x.wav" not found', '/Users/ada')

    expect(said).not.toContain('Acme')
    expect(said).toContain('“[words removed]”')
    expect(said).toContain('"~/x.wav"')
  })

  it('takes out keys and tokens, and the asset server’s secret', () => {
    const said = scrub(
      [
        'apiKey: sk-ant-api03-abcdefghijklmnop',
        'TALKIE_MCP_TOKEN=4f2c9a8b7e6d5c4b3a29',
        'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
        'github ghp_abcdefghijklmnopqrstuvwxyz0123',
        'http://127.0.0.1:51234/0123456789abcdef0123456789abcdef/p/audio.wav'
      ].join('\n')
    )

    expect(said).not.toMatch(/sk-ant|4f2c9a8b|abcdefghijklmnopqrstuvwxyz|ghp_|0123456789abcdef0123/)
    expect(said).toContain('127.0.0.1:51234/[secret removed]/p/audio.wav')
  })
})

describe('the log', () => {
  it('says which process wrote each line, every line of a stack included', () => {
    configureLog({ source: 'mcp' })
    logFailure('talkie_narrate failed', new Error('Kokoro stopped'), home)
    logEvent('Kokoro printed this', 'kokoro', home)

    const lines = readLogTail(100, home).split('\n')
    expect(lines[0]).toMatch(/^\S+ \[mcp\] talkie_narrate failed: Error: Kokoro stopped$/)
    expect(lines.filter((line) => line.includes('[mcp]')).length).toBeGreaterThan(1)
    expect(lines[lines.length - 1]).toMatch(/\[kokoro\] Kokoro printed this$/)
  })

  it('reads the end across a file that has been rolled over, older first', () => {
    logEvent('first', 'app', home)
    execFileSync('mv', [logPath(home), `${logPath(home)}.1`])
    logEvent('second', 'app', home)

    expect(readLogTail(2, home)).toMatch(/first\n.*second$/)
  })
})

describe('the doctor', () => {
  function builtFrom(commit: string): string {
    const out = join(home, 'out')
    mkdirSync(join(out, 'mcp'), { recursive: true })
    writeFileSync(join(out, 'build-info.json'), JSON.stringify({ version: '1.0.0', commit, dirty: false, builtAt: '2026-10-16T10:00:00Z' }))
    return join(out, 'mcp')
  }

  it('catches a checkout pulled but not rebuilt, and says to rebuild and restart', () => {
    const check = checkBuild(builtFrom('aaaaaaa1111'), 'bbbbbbb2222')

    expect(check.ok).toBe(false)
    expect(check.detail).toBe('Built from aaaaaaa, but the checkout is at bbbbbbb: what runs is the older code.')
    expect(check.fix).toContain('npm run build')
    expect(check.fix).toContain('restart')
  })

  it('passes a build of the commit the checkout is on', () => {
    expect(checkBuild(builtFrom('ccccccc3333'), 'ccccccc3333').ok).toBe(true)
  })

  it('says to build a checkout that never was', () => {
    expect(checkBuild(join(home, 'nowhere'), 'ddddddd4444')).toMatchObject({ ok: false, fix: 'Run `npm run build`.' })
  })

  it('checks every part, and says what to do about the voice when it is not downloaded', async () => {
    updateSettings({ speech: { engine: 'kokoro', voice: 'af_alloy' } }, home)

    const checks = await runDoctor({ baseDir: home })

    expect(checks.map((check) => check.id)).toEqual(['build', 'node', 'kokoro-worker', 'voice', 'media', 'browser', 'mcp'])
    expect(checks.find((check) => check.id === 'voice')).toMatchObject({ ok: false, fix: expect.stringContaining('Download') })
    expect(formatChecks(checks)).toMatch(/✗ Narration voice: Kokoro, af_alloy; the voice is not downloaded\.\n {4}→ Download/)
  })

  it('says which voice Kokoro really reads in when the one set is the Mac’s', async () => {
    updateSettings({ speech: { engine: 'kokoro', voice: 'Samantha' } }, home)

    const voice = (await runDoctor({ baseDir: home })).find((check) => check.id === 'voice')

    expect(voice?.detail).toContain('af_heart (the voice set, Samantha, is not a Kokoro voice)')
  })
})

describe('a problem report', () => {
  const checks: DoctorCheck[] = [{ id: 'voice', label: 'Narration voice', ok: false, detail: 'not downloaded', fix: 'Download it.' }]

  it('carries settings field by field, saying only whether a secret is set', () => {
    const settings = SettingsSchema.parse({
      narration: { provider: 'anthropic', anthropic: { apiKey: 'sk-ant-real-key-123456' }, local: { baseUrl: 'http://intranet.acme:11434' } },
      mcp: { enabled: true, tokenHash: 'deadbeefcafe' }
    })

    const summary = JSON.stringify(settingsSummary(settings))

    expect(summary).not.toMatch(/sk-ant|intranet|deadbeef/)
    expect(settingsSummary(settings)).toMatchObject({ narration: { provider: 'anthropic', anthropicKeySet: true, localAddressSet: true }, mcp: { tokenMade: true } })
  })

  it('holds nothing from a project, even where the log quotes one', () => {
    logFailure(
      `project:narrate failed on ${join(home, 'Talkie', 'Projects', 'k3x9q2m7-acme-pricing')}`,
      new Error('Kokoro read “Acme pricing changes in March for everyone” as silence'),
      home
    )

    const report = gatherReport({ description: 'Narration fails', checks, baseDir: home })
    const everything = Object.values(report.files).join('\n')

    expect(everything).not.toMatch(/acme/i)
    expect(report.files['talkie.log']).toContain('project:narrate failed')
    expect(report.summary).toContain('Narration fails')
    expect(report.summary).toContain('1 failed')
  })

  it('opens an issue with the summary filled in, cut short to fit a link', () => {
    const report = { summary: 'x'.repeat(9000), files: {} }

    const url = new URL(issueUrl(report, 'Problem: narration fails'))

    expect(url.pathname).toBe('/murthy-chelankuri/talkie/issues/new')
    expect(url.searchParams.get('title')).toBe('Problem: narration fails')
    expect(url.searchParams.get('body')!.length).toBeLessThan(6100)
  })

  it('saves as a zip of plain files anyone can read', () => {
    const report = gatherReport({ description: 'Something', checks, baseDir: home })
    const zip = join(home, 'report.zip')

    writeReportZip(report, zip)

    const listing = execFileSync('unzip', ['-l', zip], { encoding: 'utf8' })
    for (const name of ['README.txt', 'summary.md', 'about.json', 'settings.json', 'checks.json', 'talkie.log']) {
      expect(listing).toContain(`Talkie report/${name}`)
    }
  })
})
