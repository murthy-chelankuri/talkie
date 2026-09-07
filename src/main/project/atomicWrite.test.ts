import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeJsonAtomic } from './atomicWrite'

describe('writeJsonAtomic', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes pretty-printed JSON to the target path', () => {
    const target = join(dir, 'project.json')
    writeJsonAtomic(target, { id: 'abc123', name: 'Test' })

    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ id: 'abc123', name: 'Test' })
  })

  it('leaves no temp file behind after a successful write', () => {
    writeJsonAtomic(join(dir, 'project.json'), { ok: true })

    expect(readdirSync(dir)).toEqual(['project.json'])
  })

  it('overwrites an existing file', () => {
    const target = join(dir, 'project.json')
    writeJsonAtomic(target, { version: 1 })
    writeJsonAtomic(target, { version: 2 })

    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ version: 2 })
  })
})
