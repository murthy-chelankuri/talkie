import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const openPath = vi.fn(async () => '')
const showItemInFolder = vi.fn()
vi.mock('electron', () => ({ shell: { openPath: () => openPath(), showItemInFolder: (p: string) => showItemInFolder(p) } }))

const { describeExport, openExport, showExportInFinder } = await import('./revealExport')
const { projectsRootDir } = await import('../project/paths')

describe('opening a finished export', () => {
  let baseDir: string
  let exported: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-reveal-'))
    exported = join(projectsRootDir(baseDir), 'abc-demo', 'renders', 'demo-2026-09-11.mp4')
    mkdirSync(join(exported, '..'), { recursive: true })
    writeFileSync(exported, Buffer.alloc(2 * 1024 * 1024))
    openPath.mockClear()
    showItemInFolder.mockClear()
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('describes the file by name and size, not by its path', () => {
    expect(describeExport(exported, baseDir)).toEqual({
      path: exported,
      name: 'demo-2026-09-11.mp4',
      bytes: 2 * 1024 * 1024
    })
  })

  it('opens a real export', async () => {
    expect(await openExport(exported, baseDir)).toBeNull()
    expect(openPath).toHaveBeenCalled()
  })

  it('shows a real export in the finder', () => {
    expect(showExportInFinder(exported, baseDir)).toBeNull()
    expect(showItemInFolder).toHaveBeenCalledWith(exported)
  })

  it('refuses to hand the shell a path outside the projects folder', async () => {
    // The renderer should never be able to ask the operating system to open anything it likes.
    expect(await openExport('/etc/hosts', baseDir)).toContain('not part of a Talkie project')
    expect(showExportInFinder('/etc/hosts', baseDir)).toContain('not part of a Talkie project')
    expect(openPath).not.toHaveBeenCalled()
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('refuses a path that climbs out of the projects folder', async () => {
    const escaping = join(projectsRootDir(baseDir), '..', '..', 'secret.mp4')

    expect(await openExport(escaping, baseDir)).toContain('not part of a Talkie project')
    expect(openPath).not.toHaveBeenCalled()
  })

  it('says so when the export has since been deleted', async () => {
    rmSync(exported)

    expect(describeExport(exported, baseDir)).toBeNull()
    expect(await openExport(exported, baseDir)).toBe('That file is no longer there.')
  })
})
