import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { request as httpRequest } from 'http'
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

  // Regression test for a directory-boundary bug: a naive `filePath.startsWith(rootDir)`
  // check would wrongly accept a sibling like '<rootDir>-sibling/secret.txt' since it's a
  // string prefix of rootDir even though it is NOT a subpath of it. This uses a raw
  // http.request rather than fetch deliberately: fetch/URL parsing normalizes ".." out of
  // the path before the request is ever sent (verified: a fetch to ".../../root-sibling/x"
  // arrives at the server as "/root-sibling/x", not exercising this code path at all), which
  // would silently make this test pass against the vulnerable code too.
  it('returns 404 for a sibling directory that merely shares a string prefix with the root', async () => {
    const parentDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))
    const rootDir = join(parentDir, 'root')
    const siblingDir = join(parentDir, 'root-sibling')
    mkdirSync(rootDir, { recursive: true })
    mkdirSync(siblingDir, { recursive: true })
    writeFileSync(join(siblingDir, 'secret.txt'), 'should not be servable')

    const server = await getAssetServer(rootDir)
    const serverUrl = new URL(server.url)

    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        { host: serverUrl.hostname, port: serverUrl.port, path: '/../root-sibling/secret.txt' },
        (res) => resolve(res.statusCode ?? 0)
      )
      req.on('error', reject)
      req.end()
    })

    expect(status).toBe(404)

    rmSync(parentDir, { recursive: true, force: true })
  })

  it('reuses the same server instance for repeated calls with the same rootDir', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))

    const first = await getAssetServer(rootDir)
    const second = await getAssetServer(rootDir)

    expect(second.url).toBe(first.url)

    rmSync(rootDir, { recursive: true, force: true })
  })

  it('resolves to the same server when called concurrently with the same rootDir', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))

    const [first, second] = await Promise.all([getAssetServer(rootDir), getAssetServer(rootDir)])

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

  it('resolveTimelineAssetUrls merges a resolved audioUrl for items with narrated audio', () => {
    const timeline = [
      { id: 'a', kind: 'image', start: 0, duration: 90, data: { src: '/root/sources/images/photo.png' } }
    ]
    const narrationAudioPaths = new Map([['a', '/root/audio/seg-1.wav']])

    const resolved = resolveTimelineAssetUrls(timeline, '/root', 'http://127.0.0.1:5000', narrationAudioPaths)

    expect(resolved[0].data).toEqual({
      src: 'http://127.0.0.1:5000/sources/images/photo.png',
      audioUrl: 'http://127.0.0.1:5000/audio/seg-1.wav'
    })
  })

  it('resolveTimelineAssetUrls leaves items with no narrated audio unaffected', () => {
    const timeline = [
      { id: 'a', kind: 'image', start: 0, duration: 90, data: { src: '/root/sources/images/photo.png' } }
    ]

    const resolved = resolveTimelineAssetUrls(timeline, '/root', 'http://127.0.0.1:5000', new Map())

    expect(resolved[0].data).toEqual({ src: 'http://127.0.0.1:5000/sources/images/photo.png' })
  })

  it('allows cross-origin reads, so the renderer can sample video frames onto a canvas', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))
    writeFileSync(join(rootDir, 'clip.webm'), 'fake-webm-bytes')

    const server = await getAssetServer(rootDir)
    const response = await fetch(`${server.url}/clip.webm`)

    expect(response.headers.get('access-control-allow-origin')).toBe('*')

    rmSync(rootDir, { recursive: true, force: true })
  })

  it('resolveTimelineAssetUrls rewrites video item src fields', () => {
    const timeline = [
      { id: 'a', kind: 'video', start: 0, duration: 300, data: { src: '/root/sources/session-1/video.webm' } }
    ]

    const resolved = resolveTimelineAssetUrls(timeline, '/root', 'http://127.0.0.1:5000')

    expect(resolved[0].data).toEqual({ src: 'http://127.0.0.1:5000/sources/session-1/video.webm' })
  })

  it('serves a .webm file with the video/webm content type', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))
    writeFileSync(join(rootDir, 'clip.webm'), 'fake-webm-bytes')

    const server = await getAssetServer(rootDir)
    const response = await fetch(`${server.url}/clip.webm`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/webm')

    rmSync(rootDir, { recursive: true, force: true })
  })

  it('serves a .wav file with the audio/wav content type', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))
    writeFileSync(join(rootDir, 'clip.wav'), 'fake-wav-bytes')

    const server = await getAssetServer(rootDir)
    const response = await fetch(`${server.url}/clip.wav`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/wav')

    rmSync(rootDir, { recursive: true, force: true })
  })
})
