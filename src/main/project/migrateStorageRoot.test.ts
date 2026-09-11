import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { migrateStorageRoot, LEGACY_ROOT_NAME, ROOT_NAME } from './migrateStorageRoot'
import { projectsRootDir } from './paths'

describe('migrateStorageRoot', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-migrate-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  function seedLegacyProject(name = 'abc123-checkout'): string {
    const dir = join(baseDir, LEGACY_ROOT_NAME, 'Projects', name)
    mkdirSync(join(dir, 'audio'), { recursive: true })
    writeFileSync(join(dir, 'project.json'), '{"id":"abc123"}')
    writeFileSync(join(dir, 'audio', 'seg-1.wav'), 'audio-bytes')
    return dir
  }

  it('moves projects from the old home to the new one', () => {
    seedLegacyProject()

    migrateStorageRoot(baseDir)

    const moved = join(baseDir, ROOT_NAME, 'Projects', 'abc123-checkout')
    expect(readFileSync(join(moved, 'project.json'), 'utf-8')).toBe('{"id":"abc123"}')
    // Everything inside comes along, not just the metadata.
    expect(readFileSync(join(moved, 'audio', 'seg-1.wav'), 'utf-8')).toBe('audio-bytes')
    expect(existsSync(join(baseDir, LEGACY_ROOT_NAME, 'Projects'))).toBe(false)
  })

  it('clears away the emptied legacy folder', () => {
    seedLegacyProject()

    migrateStorageRoot(baseDir)

    expect(existsSync(join(baseDir, LEGACY_ROOT_NAME))).toBe(false)
  })

  it('leaves the legacy folder alone when it holds anything else', () => {
    seedLegacyProject()
    writeFileSync(join(baseDir, LEGACY_ROOT_NAME, 'notes.txt'), 'mine')

    migrateStorageRoot(baseDir)

    expect(readFileSync(join(baseDir, LEGACY_ROOT_NAME, 'notes.txt'), 'utf-8')).toBe('mine')
  })

  it('does nothing on a fresh install', () => {
    migrateStorageRoot(baseDir)

    expect(existsSync(join(baseDir, ROOT_NAME))).toBe(false)
  })

  it('never overwrites projects already in the new home', () => {
    seedLegacyProject()
    const existing = join(baseDir, ROOT_NAME, 'Projects', 'xyz789-onboarding')
    mkdirSync(existing, { recursive: true })
    writeFileSync(join(existing, 'project.json'), '{"id":"xyz789"}')

    migrateStorageRoot(baseDir)

    expect(readFileSync(join(existing, 'project.json'), 'utf-8')).toBe('{"id":"xyz789"}')
    // The old copy stays put rather than being merged in blindly.
    expect(existsSync(join(baseDir, LEGACY_ROOT_NAME, 'Projects', 'abc123-checkout'))).toBe(true)
  })

  it('is safe to run again', () => {
    seedLegacyProject()

    migrateStorageRoot(baseDir)
    migrateStorageRoot(baseDir)

    expect(existsSync(join(baseDir, ROOT_NAME, 'Projects', 'abc123-checkout'))).toBe(true)
  })

  it('leaves projects reachable even if the move never happened', () => {
    const legacy = seedLegacyProject()

    // No migration run: the app must still find the projects where they actually are.
    expect(projectsRootDir(baseDir)).toBe(join(baseDir, LEGACY_ROOT_NAME, 'Projects'))
    expect(existsSync(legacy)).toBe(true)
  })

  it('uses the new home once the projects live there', () => {
    seedLegacyProject()
    migrateStorageRoot(baseDir)

    expect(projectsRootDir(baseDir)).toBe(join(baseDir, ROOT_NAME, 'Projects'))
  })
})
