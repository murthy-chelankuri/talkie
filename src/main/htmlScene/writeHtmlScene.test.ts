import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildHtmlScenePrompt, parseHtmlScene, writeHtmlScene } from './writeHtmlScene'

describe('asking a model for an HTML scene', () => {
  it('gives it the rules, the description, and the form to answer in', () => {
    const prompt = buildHtmlScenePrompt({ instruction: 'a bar chart of revenue by region', projectName: 'Acme' })

    expect(prompt).toContain('talkie.onFrame')
    expect(prompt).toContain('--talkie-heading')
    expect(prompt).toContain('a bar chart of revenue by region')
    expect(prompt).toContain('=== index.html ===')
  })

  it('sends the scene as it stands, and what was wrong with it last time', () => {
    const prompt = buildHtmlScenePrompt({
      instruction: 'make the bars grow one at a time',
      current: { 'index.html': '<h1>Old</h1>' },
      projectName: 'Acme',
      problems: ['Uses text in #ff0000']
    })

    expect(prompt).toContain('<h1>Old</h1>')
    expect(prompt).toContain('make the bars grow one at a time')
    expect(prompt).toContain('- Uses text in #ff0000')
  })

  it('reads the files and title out of the reply', () => {
    const result = parseHtmlScene('TITLE: Revenue\n=== index.html ===\n<h1>Hi</h1>\n=== style.css ===\nh1{}\n')

    expect(result).toEqual({ status: 'written', title: 'Revenue', files: { 'index.html': '<h1>Hi</h1>\n', 'style.css': 'h1{}\n' } })
  })

  it('turns down a reply with no page in it', () => {
    expect(parseHtmlScene('Here is your scene!')).toMatchObject({ status: 'failed' })
  })

  describe('with no model chosen', () => {
    let baseDir: string
    beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'talkie-html-write-')) })
    afterEach(() => rmSync(baseDir, { recursive: true, force: true }))

    it('says it needs one, rather than failing quietly', async () => {
      const result = await writeHtmlScene({ instruction: 'a chart', projectName: 'Acme' }, baseDir)

      expect(result).toMatchObject({ status: 'failed', reason: expect.stringMatching(/Choose a model/) })
    })
  })
})
