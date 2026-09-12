import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { findCli } from './findCli'

/**
 * The reason this exists at all: an app opened from Finder gets a PATH with none of the places
 * these tools install to, so a CLI the user can run in their own terminal looks missing to us.
 */
describe('finding a command-line tool', () => {
  let dir: string
  const originalPath = process.env.PATH

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'talkie-findcli-'))
  })

  afterEach(() => {
    process.env.PATH = originalPath
    rmSync(dir, { recursive: true, force: true })
  })

  function put(name: string, { executable = true }: { executable?: boolean } = {}): string {
    const path = join(dir, name)
    writeFileSync(path, '#!/bin/sh\n')
    chmodSync(path, executable ? 0o755 : 0o644)
    return path
  }

  it('finds a command on PATH', async () => {
    const path = put('some-tool')
    process.env.PATH = dir

    expect(await findCli('some-tool')).toBe(path)
  })

  it('returns nothing for a command that is not installed', async () => {
    process.env.PATH = dir

    expect(await findCli('definitely-not-installed-xyz')).toBeNull()
  })

  it('ignores a file that is there but cannot be run', async () => {
    put('some-tool', { executable: false })
    process.env.PATH = dir

    expect(await findCli('some-tool')).toBeNull()
  })

  it('keeps the first one on PATH, so a deliberate ordering survives', async () => {
    const first = join(dir, 'first')
    const second = join(dir, 'second')
    mkdirSync(first)
    mkdirSync(second)
    for (const parent of [first, second]) {
      const path = join(parent, 'some-tool')
      writeFileSync(path, '#!/bin/sh\n')
      chmodSync(path, 0o755)
    }
    process.env.PATH = `${first}:${second}`

    expect(await findCli('some-tool')).toBe(join(first, 'some-tool'))
  })

  it('still looks in the usual install directories when PATH is empty', async () => {
    // This is the Finder case: PATH holds nothing useful, but the tool is installed.
    process.env.PATH = ''

    // `env` is in /usr/bin on every macOS, and /usr/bin is one of the directories we check.
    expect(await findCli('env')).toBe('/usr/bin/env')
  })

  it('copes with a PATH entry that does not exist', async () => {
    process.env.PATH = `${join(dir, 'gone')}:${dir}`
    const path = put('some-tool')

    expect(await findCli('some-tool')).toBe(path)
  })
})
