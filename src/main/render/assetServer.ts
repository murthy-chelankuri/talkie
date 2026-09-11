import { createServer, type Server } from 'http'
import { createReadStream, existsSync, statSync } from 'fs'
import { extname, join, normalize, relative, sep } from 'path'
import type { AddressInfo } from 'net'
import type { TimelineItem } from '../../remotion/types'
import type { NarrationAudio } from '../project/projectApi'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4'
}

// Timeline item kinds whose `data.src` is a local media path needing URL resolution.
const SRC_MEDIA_KINDS = new Set(['image', 'video'])

function parseByteRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  // A suffix range ("bytes=-500") asks for the last N bytes.
  const start = rawStart === '' ? Math.max(0, size - Number(rawEnd)) : Number(rawStart)
  const end = rawStart === '' || rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)

  if (start >= size || start > end) return 'unsatisfiable'
  return { start, end }
}

export interface AssetServer {
  url: string
  close: () => Promise<void>
}

let cachedServerPromise: Promise<AssetServer> | null = null
let cachedRootDir: string | null = null

function startAssetServer(rootDir: string): Promise<AssetServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const requestedPath = decodeURIComponent((req.url ?? '/').split('?')[0])
      const filePath = normalize(join(rootDir, requestedPath))
      // A bare `startsWith(rootDir)` is a directory-boundary bug: rootDir '/tmp/foo' would
      // wrongly accept '/tmp/foobar/secret' since it's a string prefix but not a real subpath.
      const isInsideRoot = filePath === rootDir || filePath.startsWith(rootDir + sep)

      if (!isInsideRoot || !existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404)
        res.end()
        return
      }

      const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      const size = statSync(filePath).size
      const commonHeaders = {
        'Content-Type': contentType,
        // The renderer draws video frames onto a canvas to pick a timeline thumbnail, which
        // needs the pixels to be readable rather than origin-tainted. This server is bound to
        // 127.0.0.1 and only ever serves the user's own project directory.
        'Access-Control-Allow-Origin': '*',
        // Without range support Chromium reports a media file's seekable range as empty and
        // refuses to seek it at all, which strands recordings on their first frame.
        'Accept-Ranges': 'bytes'
      }

      const range = parseByteRange(req.headers.range, size)
      if (range === 'unsatisfiable') {
        res.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${size}` })
        res.end()
        return
      }

      if (range) {
        res.writeHead(206, {
          ...commonHeaders,
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
          'Content-Length': range.end - range.start + 1
        })
        createReadStream(filePath, { start: range.start, end: range.end }).pipe(res)
        return
      }

      res.writeHead(200, { ...commonHeaders, 'Content-Length': size })
      createReadStream(filePath).pipe(res)
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res()))
      })
    })
  })
}

export function getAssetServer(rootDir: string): Promise<AssetServer> {
  if (cachedServerPromise && cachedRootDir === rootDir) {
    return cachedServerPromise
  }

  const previous = cachedServerPromise
  cachedRootDir = rootDir
  cachedServerPromise = (async () => {
    if (previous) {
      const previousServer = await previous
      await previousServer.close()
    }
    return startAssetServer(rootDir)
  })()

  return cachedServerPromise
}

export async function closeAssetServer(): Promise<void> {
  if (cachedServerPromise) {
    const server = await cachedServerPromise
    await server.close()
    cachedServerPromise = null
    cachedRootDir = null
  }
}

export function resolveAssetUrl(absolutePath: string, rootDir: string, serverUrl: string): string {
  const rel = relative(rootDir, absolutePath)
  return `${serverUrl}/${rel
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

export function resolveTimelineAssetUrls(
  timeline: TimelineItem[],
  rootDir: string,
  serverUrl: string,
  narrationAudioPaths: Map<string, NarrationAudio> = new Map()
): TimelineItem[] {
  return timeline.map((item) => {
    const narration = narrationAudioPaths.get(item.id)
    const audioUrl = narration
      ? `${resolveAssetUrl(narration.path, rootDir, serverUrl)}?v=${narration.version}`
      : undefined

    if (!SRC_MEDIA_KINDS.has(item.kind)) {
      return audioUrl ? { ...item, data: { ...(item.data as object), audioUrl } } : item
    }

    const data = item.data as { src: string }
    return {
      ...item,
      data: {
        ...data,
        src: resolveAssetUrl(data.src, rootDir, serverUrl),
        ...(audioUrl ? { audioUrl } : {})
      }
    }
  })
}
