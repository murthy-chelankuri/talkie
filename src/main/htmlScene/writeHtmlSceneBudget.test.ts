import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LONG_ANSWER } from '../agent/narrationProvider'
import { buildHtmlScenePrompt, describeLength, writeHtmlScene } from './writeHtmlScene'

const complete = vi.fn()
vi.mock('../agent/providerRegistry', () => ({
  narrationProvider: () => ({ label: 'Claude CLI', isAvailable: async () => ({ available: true }), complete })
}))

let baseDir: string
beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-scene-budget-'))
  complete.mockReset()
})
afterEach(() => rmSync(baseDir, { recursive: true, force: true }))

/**
 * A scene is a page of code, not a line of narration. Writing one used narration's limits — two
 * minutes, and 1,500 tokens on the API — so a complex scene was cut off every time; and it was
 * made five seconds long whatever was asked for, with the page never told.
 */
describe('writing a long scene', () => {
  it('gives the model the time and room a whole page needs', async () => {
    complete.mockResolvedValue('TITLE: FSD\n=== index.html ===\n<h1>FSD</h1>\n')

    await writeHtmlScene({ instruction: 'a complex animation about FSD', projectName: 'Acme', seconds: 300 }, baseDir)

    expect(complete).toHaveBeenCalledWith(expect.any(String), LONG_ANSWER)
    expect(LONG_ANSWER.timeoutMs).toBeGreaterThanOrEqual(10 * 60_000)
    expect(LONG_ANSWER.maxTokens).toBeGreaterThan(10_000)
  })

  it('tells the model how long the scene runs, so the page is paced for all of it', () => {
    expect(buildHtmlScenePrompt({ instruction: 'x', projectName: 'Acme', seconds: 300 })).toContain('The scene runs for 5 minutes (talkie.duration)')
    expect(describeLength(90)).toBe('1 minute 30 seconds')
    expect(describeLength(12)).toBe('12 seconds')
  })

  it('says plainly when the model ran out of time, and what to do about it', async () => {
    complete.mockRejectedValue(new Error('The claude CLI could not answer: it timed out'))

    const result = await writeHtmlScene({ instruction: 'everything about FSD', projectName: 'Acme' }, baseDir)

    expect(result).toEqual({
      status: 'failed',
      reason: 'Claude CLI did not finish writing the scene within 10 minutes. Describe less in one scene, or split it into several — each scene shows one idea.'
    })
  })
})
