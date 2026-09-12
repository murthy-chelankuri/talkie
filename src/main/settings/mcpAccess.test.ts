import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { checkMcpAccess, createMcpToken, revokeMcpToken, hashToken } from './mcpAccess'
import { readSettings, updateSettings, settingsPath } from './settingsStore'

let baseDir: string

function enable(): void {
  updateSettings({ mcp: { enabled: true } }, baseDir)
}

describe('who may drive Talkie from outside', () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-mcp-access-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('is nobody, until someone turns it on', () => {
    // The setting a fresh install starts from is the one that matters most here.
    expect(readSettings(baseDir).mcp.enabled).toBe(false)
    expect(checkMcpAccess('anything', baseDir)).toMatchObject({
      allowed: false,
      refusedBecause: 'disabled'
    })
  })

  it('is still nobody once it is on, until a token exists', () => {
    enable()

    expect(checkMcpAccess(undefined, baseDir)).toMatchObject({
      allowed: false,
      refusedBecause: 'no-token'
    })
  })

  it('lets the token through that was just created', () => {
    enable()
    const token = createMcpToken(baseDir)

    expect(checkMcpAccess(token, baseDir)).toMatchObject({ allowed: true })
  })

  it('refuses a caller with no token at all', () => {
    enable()
    createMcpToken(baseDir)

    expect(checkMcpAccess(undefined, baseDir)).toMatchObject({
      allowed: false,
      refusedBecause: 'missing-token'
    })
    expect(checkMcpAccess('', baseDir)).toMatchObject({ allowed: false })
  })

  it('refuses a token that is not the right one', () => {
    enable()
    createMcpToken(baseDir)

    expect(checkMcpAccess('talkie_not-the-one', baseDir)).toMatchObject({
      allowed: false,
      refusedBecause: 'wrong-token'
    })
  })

  it('stops the old token the moment a new one replaces it', () => {
    enable()
    const first = createMcpToken(baseDir)
    const second = createMcpToken(baseDir)

    expect(first).not.toBe(second)
    expect(checkMcpAccess(first, baseDir)).toMatchObject({ allowed: false })
    expect(checkMcpAccess(second, baseDir)).toMatchObject({ allowed: true })
  })

  it('stops a working token the moment it is revoked', () => {
    enable()
    const token = createMcpToken(baseDir)
    expect(checkMcpAccess(token, baseDir).allowed).toBe(true)

    revokeMcpToken(baseDir)

    expect(checkMcpAccess(token, baseDir)).toMatchObject({ allowed: false, refusedBecause: 'no-token' })
  })

  it('stops a working token the moment the switch goes off', () => {
    enable()
    const token = createMcpToken(baseDir)

    updateSettings({ mcp: { enabled: false } }, baseDir)

    expect(checkMcpAccess(token, baseDir)).toMatchObject({ allowed: false, refusedBecause: 'disabled' })
  })

  it('never writes the token itself to disk', () => {
    // The whole reason for hashing: a settings file that is backed up, synced or pasted into a
    // bug report must not carry a working credential with it.
    enable()
    const token = createMcpToken(baseDir)

    const onDisk = readFileSync(settingsPath(baseDir), 'utf-8')
    expect(onDisk).not.toContain(token)
    expect(onDisk).toContain(hashToken(token))
  })

  it('makes a token long enough not to be guessed', () => {
    const token = createMcpToken(baseDir)

    expect(token.startsWith('talkie_')).toBe(true)
    expect(token.length).toBeGreaterThan(40)
  })

  it('records when the token was made, so the settings screen can say', () => {
    createMcpToken(baseDir)

    expect(Date.parse(readSettings(baseDir).mcp.tokenCreatedAt)).not.toBeNaN()
  })

  it('keeps the rest of the settings when a token is made', () => {
    updateSettings({ speech: { voice: 'Daniel' } }, baseDir)

    createMcpToken(baseDir)

    expect(readSettings(baseDir).speech.voice).toBe('Daniel')
  })
})

describe('the settings file that holds the hash', () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-mcp-perms-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('is readable only by the person it belongs to', () => {
    // It carries an API key as well as the token hash; other accounts on the machine have no
    // business reading either.
    createMcpToken(baseDir)

    const mode = statSync(settingsPath(baseDir)).mode & 0o777
    expect(mode).toBe(0o600)
  })
})
