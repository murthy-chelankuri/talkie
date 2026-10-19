import { existsSync, readFileSync } from 'fs'
import { basename, isAbsolute, join, relative, sep } from 'path'
import { writeJsonAtomic } from './atomicWrite'

/**
 * timeline.json as it is on disk, against the timeline as the app uses it.
 *
 * A clip's media is named relative to its project's folder on disk — `sources/…/video.mp4` — and as
 * a full path everywhere else. A full path on disk tied a project to the Mac and the account that
 * made it: checked into git and cloned elsewhere, every clip pointed into someone else's home
 * folder, and repairing it rewrote timeline.json with this Mac's, so two Macs sharing a Studio
 * would rewrite the same lines back and forth on every pull.
 *
 * Only here, so nothing else in the app knows. Media outside the project folder keeps its full
 * path, since that is the only record of where it is.
 */

export function timelinePath(projectDir: string): string {
  return join(projectDir, 'timeline.json')
}

type Clip = { data?: { src?: unknown } }

function mapSrc(items: unknown[], change: (src: string) => string): unknown[] {
  return items.map((item) => {
    const src = (item as Clip)?.data?.src
    if (typeof src !== 'string') return item
    const next = change(src)
    return next === src ? item : { ...(item as object), data: { ...(item as { data: object }).data, src: next } }
  })
}

/** Where a stored path is on this Mac. */
export function resolveMediaPath(src: string, projectDir: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src
  if (!isAbsolute(src)) return join(projectDir, ...src.split('/'))
  // A project from before paths were relative, opened somewhere other than where it was made:
  // everything after its own folder's name is the part that travelled with it. The copy in this
  // project wins over the original even where both exist — a Studio copied on the same Mac would
  // otherwise go on playing, and changing, the other copy's media.
  const marker = `${sep}${basename(projectDir)}${sep}`
  const at = src.indexOf(marker)
  if (at === -1) return src
  // Only where the media really is: a guess would lose the one record of where it came from.
  const candidate = join(projectDir, src.slice(at + marker.length))
  return existsSync(candidate) ? candidate : src
}

/** How a full path is stored: relative, with forward slashes, when it is inside the project. */
export function storedMediaPath(src: string, projectDir: string): string {
  if (!isAbsolute(src)) return src
  const inside = relative(projectDir, src)
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return src
  return inside.split(sep).join('/')
}

export function readTimelineFile(projectDir: string): unknown[] {
  const raw: unknown = JSON.parse(readFileSync(timelinePath(projectDir), 'utf-8'))
  if (!Array.isArray(raw)) return raw as unknown[]
  return mapSrc(raw, (src) => resolveMediaPath(src, projectDir))
}

export function writeTimelineFile(projectDir: string, items: readonly unknown[]): void {
  writeJsonAtomic(timelinePath(projectDir), mapSrc([...items], (src) => storedMediaPath(src, projectDir)))
}

/** For a timeline written before paths were relative: true when it was rewritten. */
export function makeTimelinePortable(projectDir: string): boolean {
  if (!existsSync(timelinePath(projectDir))) return false
  const raw: unknown = JSON.parse(readFileSync(timelinePath(projectDir), 'utf-8'))
  if (!Array.isArray(raw)) return false
  const portable = mapSrc(raw, (src) => storedMediaPath(resolveMediaPath(src, projectDir), projectDir))
  // Left alone when nothing changes, so a Studio in git is not rewritten by being opened.
  if (JSON.stringify(portable) === JSON.stringify(raw)) return false
  writeJsonAtomic(timelinePath(projectDir), portable)
  return true
}
