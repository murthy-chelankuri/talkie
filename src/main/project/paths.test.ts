import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { projectsRootDir, projectDirName, findProjectDir, PROJECT_SUBDIRS } from './paths'

describe('paths', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('builds the projects root under Talkie/Projects', () => {
    expect(projectsRootDir(baseDir)).toBe(join(baseDir, 'Talkie', 'Projects'))
  })

  it('builds a project directory name from id and slug', () => {
    expect(projectDirName('abc123', 'checkout-flow')).toBe('abc123-checkout-flow')
  })

  it('finds an existing project directory by id prefix', () => {
    const root = projectsRootDir(baseDir)
    mkdirSync(join(root, 'abc123-checkout-flow'), { recursive: true })

    expect(findProjectDir('abc123', baseDir)).toBe(join(root, 'abc123-checkout-flow'))
  })

  it('returns undefined when no project matches the id', () => {
    mkdirSync(projectsRootDir(baseDir), { recursive: true })

    expect(findProjectDir('does-not-exist', baseDir)).toBeUndefined()
  })

  it('returns undefined when the projects root does not exist yet', () => {
    expect(findProjectDir('abc123', baseDir)).toBeUndefined()
  })

  it('lists the standard project subdirectories', () => {
    expect(PROJECT_SUBDIRS).toEqual([
      'sources/images',
      'sources/slides',
      'audio',
      'renders',
      'agents/runs'
    ])
  })
})
