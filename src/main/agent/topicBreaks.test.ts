import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildTopicBreakPrompt, findTopicBreaks, parseTopicBreaks } from './topicBreaks'
import type { CleanAction } from './cleanActionLog'

/** Settings of its own, so the test asks nothing of whatever the machine has configured. */
function freshSettings(): string {
  return mkdtempSync(join(tmpdir(), 'talkie-topics-'))
}

function actions(count: number): CleanAction[] {
  return Array.from({ length: count }, (_, index) => ({
    atSeconds: index * 5,
    type: 'click' as const,
    label: `clicked "thing ${index}"`
  }))
}

describe('asking where the demo changes subject', () => {
  it('reads back the moments a model gives as bare numbers', () => {
    expect(parseTopicBreaks('12\n31.5\n48', 60)).toEqual([12, 31.5, 48])
  })

  it('keeps the moments either side of a line that is commentary rather than a number', () => {
    // One stray sentence should not throw away an otherwise usable answer.
    expect(parseTopicBreaks('12\nHere the user opens the watchlist\n31', 60)).toEqual([12, 31])
  })

  it('takes a number out of a line the model decorated', () => {
    expect(parseTopicBreaks('- 12s\n* 31 seconds', 60)).toEqual([12, 31])
  })

  it('drops a moment that is not inside the recording', () => {
    // A model answering in milliseconds, or inventing a moment past the end, has not answered.
    expect(parseTopicBreaks('0\n12\n45000\n90', 60)).toEqual([12])
  })

  it('treats a reply with no numbers in it as one subject throughout', () => {
    expect(parseTopicBreaks('The whole recording is about the same thing.', 60)).toEqual([])
  })

  it('never returns the same moment twice', () => {
    expect(parseTopicBreaks('12\n12.0\n12', 60)).toEqual([12])
  })

  it('tells the model what it is reading and what it may answer', () => {
    const prompt = buildTopicBreakPrompt(
      [{ atSeconds: 4, type: 'navigation', label: 'example.com/watchlist' }],
      60
    )

    expect(prompt).toContain('[4.0] example.com/watchlist')
    expect(prompt).toContain('60-second')
    // The end of the window it may answer in, so a break cannot land where no scene could start.
    expect(prompt).toContain('55')
  })

  it('asks nothing of a recording too short to have two subjects', async () => {
    const baseDir = freshSettings()

    expect(await findTopicBreaks(actions(10), 8, baseDir)).toEqual([])
    expect(await findTopicBreaks(actions(1), 120, baseDir)).toEqual([])

    rmSync(baseDir, { recursive: true, force: true })
  })

  it('leaves the clock to it when the project has no model behind it', async () => {
    // The built-in provider writes narration from a template and has nothing to ask. Import has
    // to carry on regardless: a recording that cannot be split by subject is still a recording.
    const baseDir = freshSettings()

    expect(await findTopicBreaks(actions(12), 120, baseDir)).toEqual([])

    rmSync(baseDir, { recursive: true, force: true })
  })
})
