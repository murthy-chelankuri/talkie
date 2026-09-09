import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { appendActionLogEntry, readActionLog, type ActionLogEntry } from './actionLog'

describe('appendActionLogEntry / readActionLog', () => {
  let dir: string
  let logPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-actionlog-test-'))
    logPath = join(dir, 'actions.jsonl')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns an empty array when the log file does not exist yet', () => {
    expect(readActionLog(logPath)).toEqual([])
  })

  it('appends and reads back entries in order', () => {
    const first: ActionLogEntry = { t: 100, type: 'click', selector: '#button' }
    const second: ActionLogEntry = { t: 200, type: 'navigation', url: 'https://example.com/cart' }

    appendActionLogEntry(logPath, first)
    appendActionLogEntry(logPath, second)

    expect(readActionLog(logPath)).toEqual([first, second])
  })

  it('skips a malformed trailing line rather than failing the whole read', () => {
    appendActionLogEntry(logPath, { t: 100, type: 'click', selector: '#button' })
    appendFileSync(logPath, '{"t": 200, "type": "click", "selector": "#unterm\n', 'utf-8')

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const entries = readActionLog(logPath)

    expect(entries).toEqual([{ t: 100, type: 'click', selector: '#button' }])
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('ignores blank lines', () => {
    writeFileSync(logPath, '{"t": 100, "type": "click", "selector": "#a"}\n\n\n', 'utf-8')

    expect(readActionLog(logPath)).toEqual([{ t: 100, type: 'click', selector: '#a' }])
  })
})
