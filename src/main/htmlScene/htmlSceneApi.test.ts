import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { createProject, readTimeline } from '../project/projectApi'
import { undo } from '../project/history'
import { closeAssetServer } from '../render/assetServer'
import { setProjectTheme } from '../themes/applyTheme'
import { gatherClipEvidence } from '../agent/clipEvidence'
import { addHtmlScene, editHtmlScene, readHtmlScene, redrawStalePosters } from './htmlSceneApi'
import { GOOD, HARD_CODED } from './fixtures'

let baseDir: string
beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-html-api-'))
})
afterAll(() => closeAssetServer())

const srcOf = (projectId: string, itemId: string): string =>
  (readTimeline(projectId, baseDir).find((item) => item.id === itemId)!.data as { src: string }).src

describe('an HTML scene on the timeline', () => {
  it('arrives checked, with a poster and the words on it', async () => {
    const { id } = createProject('Demo', baseDir)

    const { item, check } = await addHtmlScene(id, { title: 'Revenue', files: { 'index.html': GOOD } }, baseDir)

    expect(check.problems).toEqual([])
    expect(existsSync(join(dirname((item.data as { src: string }).src), 'poster.png'))).toBe(true)
    expect((item.data as { posterText?: string }).posterText).toContain('Revenue')
  }, 180_000)

  it('keeps what the check found on the clip', async () => {
    const { id } = createProject('Demo', baseDir)

    const { item } = await addHtmlScene(id, { title: 'Loud', files: { 'index.html': HARD_CODED } }, baseDir)

    expect((item.data as { check?: { problems: string[] } }).check?.problems.join(' ')).toMatch(/#ff0000/)
  }, 180_000)

  it('makes a new revision when its files change, and undo goes back to the old one', async () => {
    const { id } = createProject('Demo', baseDir)
    const { item } = await addHtmlScene(id, { title: 'Revenue', files: { 'index.html': GOOD } }, baseDir)
    const first = srcOf(id, item.id)

    await editHtmlScene(id, item.id, { files: { 'index.html': GOOD.replace('Revenue', 'Profit') } }, baseDir)
    expect(srcOf(id, item.id)).not.toBe(first)

    undo(id, baseDir)
    expect(srcOf(id, item.id)).toBe(first)
  }, 180_000)

  it('keeps its files when only its values or look change', async () => {
    const { id } = createProject('Demo', baseDir)
    const { item } = await addHtmlScene(id, { title: 'Revenue', files: { 'index.html': GOOD } }, baseDir)
    const first = srcOf(id, item.id)

    await editHtmlScene(id, item.id, { params: { quarter: 'Q4' }, style: { theme: 'light' } }, baseDir)

    const { data } = readHtmlScene(id, item.id, baseDir)
    expect(data.src).toBe(first)
    expect(data.params).toEqual({ quarter: 'Q4' })
    expect(data.style.theme).toBe('light')
  }, 180_000)

  it('redraws its poster when the project’s theme changes', async () => {
    const { id } = createProject('Demo', baseDir)
    await addHtmlScene(id, { title: 'Revenue', files: { 'index.html': GOOD } }, baseDir)

    expect(await redrawStalePosters(id, baseDir)).toBe(0)
    setProjectTheme(id, 'builtin-midnight', baseDir)
    // This scene, and the opening and closing cards the first theme adds.
    expect(await redrawStalePosters(id, baseDir)).toBe(3)
  }, 180_000)

  it('is read by the narration drafter as its title and the words on screen', async () => {
    const { id } = createProject('Demo', baseDir)
    const { item } = await addHtmlScene(id, { title: 'Quarterly revenue', files: { 'index.html': GOOD }, prompt: 'bars growing' }, baseDir)

    const evidence = await gatherClipEvidence(id, item.id, baseDir)

    expect(evidence.sceneText).toContain('Quarterly revenue')
    expect(evidence.sceneText).toContain('bars growing')
    expect(evidence.sceneText).toContain('Revenue')
  }, 180_000)
})

