import { createServer, type Server } from 'http'
import { createReadStream, existsSync, statSync } from 'fs'
import { extname, join, normalize, relative, sep } from 'path'
import type { AddressInfo } from 'net'
import type { TimelineItem } from '../../remotion/types'

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

      res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream' })
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
  narrationAudioPaths: Map<string, string> = new Map()
): TimelineItem[] {
  return timeline.map((item) => {
    const audioPath = narrationAudioPaths.get(item.id)
    const audioUrl = audioPath ? resolveAssetUrl(audioPath, rootDir, serverUrl) : undefined

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
