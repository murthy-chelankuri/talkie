import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../project/projectApi'
import { importScene } from './import'
import { rewriteBundledCdns } from './cdn'
import { readRevision } from './store'

let baseDir: string
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'talkie-html-import-')) })
afterEach(() => rmSync(baseDir, { recursive: true, force: true }))

describe('a page brought in from elsewhere', () => {
  it('uses Talkie’s own copy of a library it loaded from a CDN', () => {
    const { html, remote } = rewriteBundledCdns(
      '<script src="https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js"></script><script src="https://d3js.org/d3.v7.min.js"></script>',
      '__TALKIE_LIB__/'
    )
    expect(html).toContain('src="__TALKIE_LIB__/anime.min.js"')
    expect(html).toContain('src="__TALKIE_LIB__/d3.min.js"')
    expect(remote).toEqual([])
  })

  it('leaves a link alone, since following one is not loading it', () => {
    expect(rewriteBundledCdns('<a href="https://example.com/anime.min.js">docs</a>', '__TALKIE_LIB__/')).toEqual({
      html: '<a href="https://example.com/anime.min.js">docs</a>',
      remote: []
    })
  })

  it('names a stylesheet or image a style block loads from the internet', () => {
    const { remote } = rewriteBundledCdns(
      '<style>@import url("https://fonts.googleapis.com/css2?family=Inter"); .hero { background: url(https://cdn.example.com/bg.jpg) }</style>',
      '__TALKIE_LIB__/'
    )
    expect(remote).toEqual(['https://fonts.googleapis.com/css2?family=Inter', 'https://cdn.example.com/bg.jpg'])
  })

  it('names anything else it loads from the internet, since that cannot load', () => {
    const { remote } = rewriteBundledCdns(
      '<script src="https://cdn.example.com/chart.js"></script><link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter"><img src="//images.example.com/a.png">',
      '__TALKIE_LIB__/'
    )
    expect(remote).toEqual(['https://cdn.example.com/chart.js', 'https://fonts.googleapis.com/css?family=Inter', '//images.example.com/a.png'])
  })

  it('brings a folder in with its images, and leaves out what a scene cannot hold', () => {
    const { id } = createProject('Demo', baseDir)
    const folder = join(baseDir, 'page')
    mkdirSync(join(folder, 'img'), { recursive: true })
    writeFileSync(join(folder, 'index.html'), '<img src="img/a.png">')
    writeFileSync(join(folder, 'img', 'a.png'), 'png')
    writeFileSync(join(folder, 'notes.docx'), 'x')

    const { src, warnings } = importScene(id, folder, baseDir)

    expect(readRevision(src).map((f) => f.path).sort()).toEqual(['img/a.png', 'index.html'])
    expect(warnings.join(' ')).toMatch(/notes\.docx/)
  })

  it('brings a single page in on its own', () => {
    const { id } = createProject('Demo', baseDir)
    const page = join(baseDir, 'chart.html')
    writeFileSync(page, '<script src="https://unpkg.com/lottie-web@5.12.2/build/player/lottie.min.js"></script>')

    const { src } = importScene(id, page, baseDir)

    expect(readFileSync(src, 'utf-8')).toContain('__TALKIE_LIB__/lottie.min.js')
  })
})
