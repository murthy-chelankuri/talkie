import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readSettings, updateSettings, settingsPath } from './settingsStore'

describe('settings store', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-settings-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('starts every install on the provider that needs nothing installed', () => {
    const settings = readSettings(baseDir)

    expect(settings.narration.provider).toBe('template')
    expect(settings.narration.autoDraft).toBe(true)
  })

  it('keeps settings beside the projects, not inside one', () => {
    expect(settingsPath(baseDir)).toBe(join(baseDir, 'Talkie', 'settings.json'))
  })

  it('remembers a changed provider', () => {
    updateSettings({ narration: { provider: 'ollama' } }, baseDir)

    expect(readSettings(baseDir).narration.provider).toBe('ollama')
  })

  it('leaves untouched settings at their defaults when one changes', () => {
    updateSettings({ narration: { provider: 'claude-cli' } }, baseDir)

    const settings = readSettings(baseDir)
    expect(settings.narration.autoDraft).toBe(true)
    expect(settings.narration.ollama.baseUrl).toBe('http://127.0.0.1:11434')
  })

  it('merges into nested provider config without dropping its siblings', () => {
    updateSettings({ narration: { ollama: { model: 'llama3.2-vision' } } }, baseDir)

    const { ollama } = readSettings(baseDir).narration
    expect(ollama.model).toBe('llama3.2-vision')
    expect(ollama.baseUrl).toBe('http://127.0.0.1:11434')
  })

  it('can turn auto-drafting off', () => {
    updateSettings({ narration: { autoDraft: false } }, baseDir)

    expect(readSettings(baseDir).narration.autoDraft).toBe(false)
  })

  it('returns the new settings so a caller need not read them back', () => {
    const returned = updateSettings({ narration: { provider: 'anthropic' } }, baseDir)

    expect(returned.narration.provider).toBe('anthropic')
  })

  it('falls back to defaults rather than failing on an unreadable file', () => {
    mkdirSync(join(baseDir, 'Talkie'), { recursive: true })
    writeFileSync(settingsPath(baseDir), 'this is not json')

    expect(readSettings(baseDir).narration.provider).toBe('template')
  })

  it('replaces a setting whose stored value is no longer valid', () => {
    mkdirSync(join(baseDir, 'Talkie'), { recursive: true })
    writeFileSync(settingsPath(baseDir), JSON.stringify({ narration: { provider: 'gpt-9' } }))

    // An unknown provider must not leave the app trying to call something that cannot exist.
    expect(readSettings(baseDir).narration.provider).toBe('template')
  })

  it('writes readable json a person can edit by hand', () => {
    updateSettings({ narration: { provider: 'ollama' } }, baseDir)

    expect(readFileSync(settingsPath(baseDir), 'utf-8')).toContain('\n  ')
  })
})
