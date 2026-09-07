import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getAssetServer, closeAssetServer, resolveAssetUrl, resolveTimelineAssetUrls } from './assetServer'

describe('asset server', () => {
  afterEach(async () => {
    await closeAssetServer()
  })

  it('serves a real file over HTTP from the given root directory', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))
    writeFileSync(join(rootDir, 'photo.png'), 'fake-png-bytes')

    const server = await getAssetServer(rootDir)
    const response = await fetch(`${server.url}/photo.png`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('fake-png-bytes')

    rmSync(rootDir, { recursive: true, force: true })
  })

  it('serves nested files using their relative path', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))
    mkdirSync(join(rootDir, 'sub'), { recursive: true })
    writeFileSync(join(rootDir, 'sub', 'photo.png'), 'nested-bytes')

    const server = await getAssetServer(rootDir)
    const response = await fetch(`${server.url}/sub/photo.png`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('nested-bytes')

    rmSync(rootDir, { recursive: true, force: true })
  })

  it('returns 404 for a path that escapes the root directory', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))

    const server = await getAssetServer(rootDir)
    const response = await fetch(`${server.url}/../../../etc/passwd`)

    expect(response.status).toBe(404)

    rmSync(rootDir, { recursive: true, force: true })
  })

  it('reuses the same server instance for repeated calls with the same rootDir', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))

    const first = await getAssetServer(rootDir)
    const second = await getAssetServer(rootDir)

    expect(second.url).toBe(first.url)

    rmSync(rootDir, { recursive: true, force: true })
  })

  it('resolveAssetUrl converts an absolute path under root into a fetchable URL', () => {
    const url = resolveAssetUrl('/root/sources/images/photo.png', '/root', 'http://127.0.0.1:5000')

    expect(url).toBe('http://127.0.0.1:5000/sources/images/photo.png')
  })

  it('resolveTimelineAssetUrls rewrites image item src fields only', () => {
    const timeline = [
      { id: 'a', kind: 'image', start: 0, duration: 90, data: { src: '/root/sources/images/photo.png' } }
    ]

    const resolved = resolveTimelineAssetUrls(timeline, '/root', 'http://127.0.0.1:5000')

    expect(resolved[0].data).toEqual({ src: 'http://127.0.0.1:5000/sources/images/photo.png' })
  })
})
