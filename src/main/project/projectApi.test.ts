import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from './projectApi'
import { projectsRootDir, findProjectDir, PROJECT_SUBDIRS } from './paths'

describe('createProject', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('returns metadata with a generated id and the given name', () => {
    const metadata = createProject('Checkout Flow', baseDir)

    expect(metadata.name).toBe('Checkout Flow')
    expect(metadata.id).toBeTruthy()
    expect(metadata.schemaVersion).toBe(1)
  })

  it('creates the project directory with the expected subdirectories', () => {
    const metadata = createProject('Checkout Flow', baseDir)
    const dir = findProjectDir(metadata.id, baseDir)

    expect(dir).toBeDefined()
    for (const subdir of PROJECT_SUBDIRS) {
      expect(existsSync(join(dir as string, subdir))).toBe(true)
    }
  })

  it('writes project.json, timeline.json, and transcript.json', () => {
    const metadata = createProject('Checkout Flow', baseDir)
    const dir = findProjectDir(metadata.id, baseDir) as string

    expect(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf-8'))).toEqual(metadata)
    expect(JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf-8'))).toEqual([])
    expect(JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf-8'))).toEqual([])
  })

  it('slugifies the name into the folder name', () => {
    const metadata = createProject('Checkout Flow!', baseDir)
    const dir = findProjectDir(metadata.id, baseDir) as string

    expect(dir.endsWith(`${metadata.id}-checkout-flow`)).toBe(true)
  })
})
