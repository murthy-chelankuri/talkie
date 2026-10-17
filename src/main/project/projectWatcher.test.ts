import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { watchProjectFolder, type ProjectWatcher } from './projectWatcher'
import { writeJsonAtomic } from './atomicWrite'

let dir: string
let watcher: ProjectWatcher | null = null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'talkie-watch-'))
  writeFileSync(join(dir, 'timeline.json'), '[]')
  writeFileSync(join(dir, 'transcript.json'), '[]')
})

afterEach(() => {
  watcher?.close()
  watcher = null
  rmSync(dir, { recursive: true, force: true })
})

/** What another process — an agent's MCP server — does: the same files, none of this process's record. */
function writeFromElsewhere(name: string, data: unknown): void {
  writeFileSync(join(dir, name), JSON.stringify(data, null, 2))
}

describe('watching an open project for changes made outside the app', () => {
  it('says so when another process changes the timeline', async () => {
    const changed = vi.fn()
    watcher = watchProjectFolder(dir, changed, 20)
    // macOS starts delivering a folder's events a moment after it is asked to.
    await new Promise((done) => setTimeout(done, 200))

    writeFromElsewhere('timeline.json', [{ id: 'new' }])

    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1), { timeout: 3000 })
  })

  it('keeps quiet about the app’s own saves', async () => {
    const changed = vi.fn()
    watcher = watchProjectFolder(dir, changed, 20)

    writeJsonAtomic(join(dir, 'timeline.json'), [{ id: 'mine' }])
    await new Promise((done) => setTimeout(done, 300))
    watcher.check()

    expect(changed).not.toHaveBeenCalled()
  })

  it('finds a change it was not woken for when asked to look', () => {
    const changed = vi.fn()
    watcher = watchProjectFolder(dir, changed, 60_000)

    writeFromElsewhere('transcript.json', [{ id: 's1' }])
    watcher.check()

    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('reports a change once, not every time it looks', () => {
    const changed = vi.fn()
    watcher = watchProjectFolder(dir, changed, 60_000)

    writeFromElsewhere('timeline.json', [{ id: 'a' }])
    watcher.check()
    watcher.check()

    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('takes what is on disk as known once the app has read it all again', () => {
    const changed = vi.fn()
    watcher = watchProjectFolder(dir, changed, 60_000)

    writeFromElsewhere('timeline.json', [{ id: 'a' }])
    watcher.accept()
    watcher.check()

    expect(changed).not.toHaveBeenCalled()
  })

  it('notices a versions file appearing', () => {
    const changed = vi.fn()
    watcher = watchProjectFolder(dir, changed, 60_000)

    writeFromElsewhere('versions.json', { active: 'full', versions: [] })
    watcher.check()

    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('ignores files the editor does not show from', () => {
    const changed = vi.fn()
    watcher = watchProjectFolder(dir, changed, 60_000)

    writeFileSync(join(dir, 'notes.txt'), 'hello')
    watcher.check()

    expect(changed).not.toHaveBeenCalled()
  })
})
