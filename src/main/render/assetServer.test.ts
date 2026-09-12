import { describe, expect, it, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
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
    const narrationAudioPaths = new Map([['a', { path: '/root/audio/seg-1.wav', version: 1700 }]])

    const resolved = resolveTimelineAssetUrls(timeline, '/root', 'http://127.0.0.1:5000', narrationAudioPaths)

    // The version changes whenever the audio is re-recorded, so the renderer refetches it.
    expect(resolved[0].data).toEqual({
      src: 'http://127.0.0.1:5000/sources/images/photo.png',
      audioUrl: 'http://127.0.0.1:5000/audio/seg-1.wav?v=1700'
    })
  })

  it('resolveTimelineAssetUrls leaves items with no narrated audio unaffected', () => {
    const timeline = [
      { id: 'a', kind: 'image', start: 0, duration: 90, data: { src: '/root/sources/images/photo.png' } }
    ]

    const resolved = resolveTimelineAssetUrls(timeline, '/root', 'http://127.0.0.1:5000', new Map())

    expect(resolved[0].data).toEqual({ src: 'http://127.0.0.1:5000/sources/images/photo.png' })
  })

  it('ignores a cache-busting query when finding the file', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))
    writeFileSync(join(rootDir, 'seg.wav'), 'audio-bytes')

    const server = await getAssetServer(rootDir)
    const response = await fetch(`${server.url}/seg.wav?v=1700`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('audio-bytes')

    rmSync(rootDir, { recursive: true, force: true })
  })

  it('advertises range support, without which Chromium reports media as unseekable', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))
    writeFileSync(join(rootDir, 'clip.webm'), '0123456789')

    const server = await getAssetServer(rootDir)
    const response = await fetch(`${server.url}/clip.webm`)

    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-length')).toBe('10')

    rmSync(rootDir, { recursive: true, force: true })
  })

  it('serves a byte range as a 206 so media can be seeked', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))
    writeFileSync(join(rootDir, 'clip.webm'), '0123456789')

    const server = await getAssetServer(rootDir)
    const response = await fetch(`${server.url}/clip.webm`, { headers: { Range: 'bytes=2-5' } })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await response.text()).toBe('2345')

    rmSync(rootDir, { recursive: true, force: true })
  })

  it('serves an open-ended byte range to the end of the file', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))
    writeFileSync(join(rootDir, 'clip.webm'), '0123456789')

    const server = await getAssetServer(rootDir)
    const response = await fetch(`${server.url}/clip.webm`, { headers: { Range: 'bytes=7-' } })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 7-9/10')
    expect(await response.text()).toBe('789')

    rmSync(rootDir, { recursive: true, force: true })
  })

  it('rejects a range that starts past the end of the file', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-asset-test-'))
    writeFileSync(join(rootDir, 'clip.webm'), '0123456789')

    const server = await getAssetServer(rootDir)
    const response = await fetch(`${server.url}/clip.webm`, { headers: { Range: 'bytes=50-60' } })

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */10')

    rmSync(rootDir, { recursive: true, force: true })
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

    // A video also carries where its clicks landed; with no log beside it, that is simply empty.
    expect(resolved[0].data).toEqual({
      src: 'http://127.0.0.1:5000/sources/session-1/video.webm',
      focus: []
    })
  })

  it('gives a video clip the clicks inside it, timed from its own start', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'demo-editor-focus-test-'))
    const session = join(rootDir, 'sources', 'session-1')
    mkdirSync(session, { recursive: true })
    writeFileSync(
      join(session, 'actions.jsonl'),
      [
        // Before the trim: belongs to a part of the recording this clip does not show.
        JSON.stringify({ t: 500, type: 'click', x: 0.1, y: 0.1 }),
        JSON.stringify({ t: 4000, type: 'click', x: 0.4, y: 0.6 }),
        // Past the end of the clip.
        JSON.stringify({ t: 60000, type: 'click', x: 0.9, y: 0.9 })
      ].join('\n')
    )

    const timeline = [
      {
        id: 'a',
        kind: 'video',
        start: 0,
        duration: 300,
        data: { src: join(session, 'video.webm'), trimBefore: 60 }
      }
    ]

    const focus = (resolveTimelineAssetUrls(timeline, rootDir, 'http://127.0.0.1:5000')[0].data as {
      focus: { frame: number; x: number }[]
    }).focus

    // Only the one inside the clip, and shifted by the two seconds trimmed off the front.
    expect(focus).toHaveLength(1)
    expect(focus[0].frame).toBe(Math.round(4 * 30) - 60)
    expect(focus[0].x).toBe(0.4)

    rmSync(rootDir, { recursive: true, force: true })
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
