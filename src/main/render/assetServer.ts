import { createServer, type Server } from 'http'
import { randomBytes } from 'crypto'
import { createReadStream, existsSync, statSync } from 'fs'
import { dirname, extname, join, normalize, relative, sep } from 'path'
import type { AddressInfo } from 'net'
import type { TimelineItem } from '../../remotion/types'
import type { NarrationAudio } from '../project/projectApi'
import { readActionLog } from '../capture/actionLog'
import { mergeFocuses, type ClickFocus } from '../../remotion/clickZoom'
import type { Caption as CaptionCue } from '../transcript/captions'
import { FPS } from '../../remotion/constants'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4'
}

// Timeline item kinds whose `data.src` is a local media path needing URL resolution.
const SRC_MEDIA_KINDS = new Set(['image', 'video', 'diagram'])

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
  /**
   * A secret every URL carries, because loopback is not a boundary.
   *
   * Any page in any browser on this machine can reach 127.0.0.1 and walk the few thousand
   * ephemeral ports until it finds this one. What it cannot do is guess this, so knowing a URL
   * is what stands in for an origin the server has no other way to check — the renderer is
   * `file://`, whose origin is `null`, so the frames it draws to canvas need permissive CORS and
   * CORS therefore cannot be the control.
   */
  const secret = randomBytes(16).toString('hex')

  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const refuse = (): void => {
        // The same answer as a missing file, so probing cannot tell a wrong guess from a wrong
        // path and map out what is here.
        res.writeHead(404)
        res.end()
      }

      // A request whose Host is anything but the loopback address this server answers on is one
      // that arrived through a name resolved to 127.0.0.1 — the shape of a DNS rebinding, which
      // exists precisely to give a remote page a same-origin path to a local service.
      const port = (server.address() as AddressInfo | null)?.port
      const host = req.headers.host
      if (!host || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
        refuse()
        return
      }

      const requestedPath = decodeURIComponent((req.url ?? '/').split('?')[0])
      if (!requestedPath.startsWith(`/${secret}/`)) {
        refuse()
        return
      }

      const filePath = normalize(join(rootDir, requestedPath.slice(secret.length + 2)))
      // A bare `startsWith(rootDir)` is a directory-boundary bug: rootDir '/tmp/foo' would
      // wrongly accept '/tmp/foobar/secret' since it's a string prefix but not a real subpath.
      const isInsideRoot = filePath === rootDir || filePath.startsWith(rootDir + sep)

      if (!isInsideRoot || !existsSync(filePath) || !statSync(filePath).isFile()) {
        refuse()
        return
      }

      const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      const size = statSync(filePath).size
      const commonHeaders = {
        'Content-Type': contentType,
        // The renderer draws video frames onto a canvas to pick a timeline thumbnail, which
        // needs the pixels to be readable rather than origin-tainted. It loads from `file://`,
        // whose origin is `null`, so no narrower value would work. What keeps this from being an
        // open door is the secret in the path, not this header.
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
        // The secret rides in the base URL, so everything built on it is scoped without
        // any caller needing to know the scheme exists.
        url: `http://127.0.0.1:${port}/${secret}`,
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

/**
 * The clicks inside one clip, as frames from that clip's own start.
 *
 * The action log sits beside the recording and is written in milliseconds from the moment the
 * browser opened, so a clip trimmed at the front has to have that taken off — otherwise the
 * picture would lean towards a click a second before it happened.
 */
function focusesFor(videoPath: string, item: TimelineItem, trimBefore: number): ClickFocus[] {
  try {
    const entries = readActionLog(join(dirname(videoPath), 'actions.jsonl'))

    const focuses = entries
      .filter((entry) => entry.type === 'click' && typeof entry.x === 'number')
      .map((entry) => ({
        frame: Math.round((entry.t / 1000) * FPS) - trimBefore,
        x: entry.x as number,
        y: entry.y as number
      }))
      .filter((focus) => focus.frame >= 0 && focus.frame < item.duration)

    return mergeFocuses(focuses)
  } catch {
    // A recording with no log still plays; it simply does not lean anywhere.
    return []
  }
}

export function resolveTimelineAssetUrls(
  timeline: TimelineItem[],
  rootDir: string,
  serverUrl: string,
  narrationAudioPaths: Map<string, NarrationAudio> = new Map(),
  /** Cues to paint into the picture, when the user has asked for them. Empty otherwise. */
  captionsByItem: Record<string, CaptionCue[]> = {}
): TimelineItem[] {
  return timeline.map((item) => {
    const narration = narrationAudioPaths.get(item.id)
    const captions = captionsByItem[item.id]
    const audioUrl = narration
      ? `${resolveAssetUrl(narration.path, rootDir, serverUrl)}?v=${narration.version}`
      : undefined

    if (!SRC_MEDIA_KINDS.has(item.kind)) {
      return audioUrl || captions
        ? {
            ...item,
            data: {
              ...(item.data as object),
              ...(audioUrl ? { audioUrl } : {}),
              ...(captions ? { captions } : {})
            }
          }
        : item
    }

    const data = item.data as { src: string; trimBefore?: number }
    return {
      ...item,
      data: {
        ...data,
        src: resolveAssetUrl(data.src, rootDir, serverUrl),
        ...(audioUrl ? { audioUrl } : {}),
        ...(captions ? { captions } : {}),
        // Where the clicks in this clip landed, so the picture can lean towards them.
        ...(item.kind === 'video' ? { focus: focusesFor(data.src, item, data.trimBefore ?? 0) } : {})
      }
    }
  })
}
