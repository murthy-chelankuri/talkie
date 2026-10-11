import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { htmlSceneResource, templatesDir } from './resources'
import { join } from 'path'

describe('what a scene is served besides its own files', () => {
  it('has the runtime, the host and the three bundled libraries, from a checkout too', () => {
    for (const name of ['runtime.js', 'host.js', 'host.html', 'lib/anime.min.js', 'lib/d3.min.js', 'lib/lottie.min.js', 'fonts/geist.woff2', 'fonts/newsreader.woff2']) {
      const found = htmlSceneResource(name)
      expect(found, name).not.toBeNull()
      expect(readFileSync(found!.path).length, name).toBeGreaterThan(100)
    }
    expect(readFileSync(htmlSceneResource('runtime.js')!.path, 'utf-8')).toContain('talkie:seek')
  })

  it('has nothing else', () => {
    expect(htmlSceneResource('../package.json')).toBeNull()
    expect(htmlSceneResource('lib/gsap.min.js')).toBeNull()
  })

  it('has the templates', () => {
    expect(existsSync(join(templatesDir(), 'bar-chart', 'index.html'))).toBe(true)
  })
})
