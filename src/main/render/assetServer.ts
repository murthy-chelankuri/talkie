import { createServer, type Server } from 'http'
import { randomBytes } from 'crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'fs'
import { dirname, extname, join, normalize, relative, sep } from 'path'
import type { AddressInfo } from 'net'
import type { TimelineItem } from '../../remotion/types'
import type { NarrationAudio } from '../project/projectApi'
import { readActionLog } from '../capture/actionLog'
import { VIDEO_TIME_LOG } from '../capture/rebaseActionLog'
import { mergeFocuses, type ClickFocus } from '../../remotion/clickZoom'
import type { Caption as CaptionCue } from '../transcript/captions'
import { FPS } from '../../remotion/constants'
import { htmlSceneResource } from '../htmlScene/resources'
import { injectRuntime, scenePolicy } from '../htmlScene/policy'
import { footageFrame } from './exporter/frameSource'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  // What HTML scenes are made of — see htmlScene/store.ts for the full list a scene may hold.
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
}

// Timeline item kinds whose `data.src` is a local media path needing URL resolution.
const SRC_MEDIA_KINDS = new Set(['image', 'video', 'diagram', 'html'])

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

      // Talkie's own files for HTML scenes — the runtime, the headless host, the libraries — by name
      // from a fixed list, never by path, so nothing outside that list is reachable this way.
      const afterSecret = requestedPath.slice(secret.length + 1)
      if (afterSecret.startsWith('/__talkie/')) {
        const resource = htmlSceneResource(afterSecret.slice('/__talkie/'.length))
        if (!resource || !existsSync(resource.path)) {
          refuse()
          return
        }
        res.writeHead(200, {
          'Content-Type': resource.type,
          'Access-Control-Allow-Origin': '*',
          // The check's host page frames one scene. A sandboxed frame may still navigate itself —
          // to an address carrying its own URL, secret and all — and only the framing page's
          // policy can stop that, so this one allows frames from here and nowhere else.
          ...(resource.path.endsWith('host.html')
            ? { 'Content-Security-Policy': "default-src 'self'; img-src data:; style-src 'unsafe-inline'; frame-src http://127.0.0.1:*" }
            : {})
        })
        createReadStream(resource.path).pipe(res)
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

      // A scene page: Talkie's runtime goes in first, and a policy keeps it off the network and out
      // of every folder but its own. Only pages under sources/html; other HTML is served as it is.
      if (extname(filePath).toLowerCase() === '.html' && filePath.includes(`${sep}sources${sep}html${sep}`)) {
        const base = `http://127.0.0.1:${port}/${secret}`
        const folderUrl = resolveAssetUrl(dirname(filePath), rootDir, base) + '/'
        const body = Buffer.from(injectRuntime(readFileSync(filePath, 'utf-8'), base))
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': scenePolicy(folderUrl, base),
          // A DNS lookup is a message too: prefetching a name made of data would carry it out.
          'X-DNS-Prefetch-Control': 'off',
          'Content-Length': body.length
        })
        res.end(body)
        return
      }

      // A recording's frame, for the export page — see exporter/frameSource.ts. On the video's
      // own URL, so the per-run secret and the projects-folder boundary apply exactly as they do
      // to the video itself.
      const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
      const asked = query.get('frame')
      if (asked !== null && ['.mp4', '.webm'].includes(extname(filePath).toLowerCase())) {
        const frame = Number(asked)
        if (!Number.isInteger(frame) || frame < 0) {
          refuse()
          return
        }
        footageFrame(query.get('reader') ?? '', filePath, frame).then(
          (jpeg) => {
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpeg.length, 'Cache-Control': 'no-store' })
            res.end(jpeg)
          },
          (err: unknown) => {
            console.error(`Could not decode frame ${frame} of ${filePath}:`, err)
            refuse()
          }
        )
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
 * `trimBefore` counts frames of the stitched video, so the log has to be the one written on the
 * video's own clock — the session log it sits beside runs on a different one the moment a
 * recording spans more than one tab, and reading that one leant the picture towards clicks that
 * had not happened yet. See rebaseActionLog.ts.
 *
 * Bounded by the footage the clip plays rather than by how long it is on screen: a scene whose
 * narration outgrew its footage holds its last frame, and it should not go on leaning towards
 * clicks that belong to the scene after it.
 */
function focusesFor(videoPath: string, item: TimelineItem, trimBefore: number, trimAfter?: number): ClickFocus[] {
  try {
    const entries = readActionLog(logBeside(videoPath))
    const lastFrame = Math.min(item.duration, (trimAfter ?? Infinity) - trimBefore)

    const focuses = entries
      .filter((entry) => entry.type === 'click' && typeof entry.x === 'number')
      .map((entry) => ({
        frame: Math.round((entry.t / 1000) * FPS) - trimBefore,
        x: entry.x as number,
        y: entry.y as number
      }))
      .filter((focus) => focus.frame >= 0 && focus.frame < lastFrame)

    return mergeFocuses(focuses)
  } catch {
    // A recording with no log still plays; it simply does not lean anywhere.
    return []
  }
}

/** The log timed against this video, falling back to the session log for recordings made
 * before the two could differ. */
function logBeside(videoPath: string): string {
  const onVideoClock = join(dirname(videoPath), VIDEO_TIME_LOG)
  return existsSync(onVideoClock) ? onVideoClock : join(dirname(videoPath), 'actions.jsonl')
}

export function resolveTimelineAssetUrls(
  timeline: TimelineItem[],
  rootDir: string,
  serverUrl: string,
  narrationAudioPaths: Map<string, NarrationAudio> = new Map(),
  /** Cues to paint into the picture, when the user has asked for them. Empty otherwise. */
  captionsByItem: Record<string, CaptionCue[]> = {},
  /**
   * When each thing is said over each clip, so a slide can show a line as it is spoken rather
   * than a fixed moment after it appears. See revealOnBeat.ts.
   */
  beatsByItem: Record<string, { at: number; text: string }[]> = {}
): TimelineItem[] {
  return timeline.map((item) => {
    const narration = narrationAudioPaths.get(item.id)
    const captions = captionsByItem[item.id]
    const beats = beatsByItem[item.id]
    const audioUrl = narration
      ? `${resolveAssetUrl(narration.path, rootDir, serverUrl)}?v=${narration.version}`
      : undefined

    if (!SRC_MEDIA_KINDS.has(item.kind)) {
      return audioUrl || captions || beats
        ? {
            ...item,
            data: {
              ...(item.data as object),
              ...(audioUrl ? { audioUrl } : {}),
              ...(captions ? { captions } : {}),
              ...(beats ? { beats } : {})
            }
          }
        : item
    }

    const data = item.data as { src: string; trimBefore?: number; trimAfter?: number }
    return {
      ...item,
      data: {
        ...data,
        src: resolveAssetUrl(data.src, rootDir, serverUrl),
        ...(audioUrl ? { audioUrl } : {}),
        ...(captions ? { captions } : {}),
        ...(beats ? { beats } : {}),
        // A scene's still for the timeline, once one has been drawn — see htmlScene/htmlSceneApi.ts.
        ...(item.kind === 'html' && existsSync(join(dirname(data.src), 'poster.png'))
          ? {
              posterUrl: `${resolveAssetUrl(join(dirname(data.src), 'poster.png'), rootDir, serverUrl)}?v=${encodeURIComponent((item.data as { posterStamp?: string }).posterStamp ?? '')}`
            }
          : {}),
        // Where the clicks in this clip landed, so the picture can lean towards them.
        ...(item.kind === 'video'
          ? { focus: focusesFor(data.src, item, data.trimBefore ?? 0, data.trimAfter) }
          : {})
      }
    }
  })
}
