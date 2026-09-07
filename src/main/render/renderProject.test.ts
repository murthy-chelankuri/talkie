import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, statSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../project/projectApi'
import { addTimelineItem } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { renderProjectVideo } from './renderProject'
import { closeAssetServer } from './assetServer'

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('renderProjectVideo', () => {
  afterEach(async () => {
    await closeAssetServer()
  })

  it('renders the project timeline to a real MP4 file in renders/', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-render-test-'))
    const project = createProject('Render Test', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    const imagePath = join(dir, 'sources', 'images', 'pixel.png')
    writeFileSync(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'))
    addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: imagePath } }, baseDir)

    const outputPath = await renderProjectVideo(project.id, baseDir)

    expect(statSync(outputPath).size).toBeGreaterThan(0)
    expect(readdirSync(join(dir, 'renders'))).toContain(outputPath.split('/').pop())

    rmSync(baseDir, { recursive: true, force: true })
  }, 180_000)
})
