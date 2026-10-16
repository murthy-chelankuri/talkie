import { z } from 'zod'

/**
 * Versions of one project: the same scenes, cut differently — the full walkthrough, a two-minute
 * one, one for sales — each remembering which scenes it leaves out.
 *
 * A version leaves scenes out rather than listing the ones it keeps, so a scene added later is in
 * every version until someone takes it out of one; nobody has to remember to add it to each.
 * Left-out scenes stay on the timeline, dimmed, where they can be put back; only what plays and
 * what is exported is cut. One version is always the one being worked on.
 *
 * Pure, with no Node in it: the window, the export and the MCP server all cut a timeline the same
 * way, and the window maps its playhead through the same functions. Stored in the project's
 * `versions.json` (versionsStore.ts), which undo keeps with the timeline.
 */

export const VersionSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** The ids of the clips this version does not play. */
  leftOut: z.array(z.string()).default([])
})

export const VersionsSchema = z.object({
  active: z.string(),
  versions: z.array(VersionSchema).min(1)
})

export type Version = z.infer<typeof VersionSchema>
export type Versions = z.infer<typeof VersionsSchema>

/** What every project is before anyone makes a version: all of it. */
export const FULL_VIDEO: Version = { id: 'full', name: 'Full video', leftOut: [] }
export const NO_VERSIONS: Versions = { active: FULL_VIDEO.id, versions: [FULL_VIDEO] }

export function activeVersion(versions: Versions): Version {
  return versions.versions.find((version) => version.id === versions.active) ?? versions.versions[0]
}

type Clip = { id: string; start: number; duration: number }

/**
 * The timeline as this version plays it: the left-out clips gone, and everything after each one
 * moved up by its length, so the video runs on without a hole. A gap the timeline already had is
 * kept as it was.
 */
export function playable<T extends Clip>(timeline: T[], leftOut: readonly string[]): T[] {
  if (leftOut.length === 0) return timeline
  const out = new Set(leftOut)
  const ordered = [...timeline].sort((a, b) => a.start - b.start)
  let removed = 0
  const kept: T[] = []
  for (const clip of ordered) {
    if (out.has(clip.id)) removed += clip.duration
    else kept.push(removed ? { ...clip, start: clip.start - removed } : clip)
  }
  return kept
}

/**
 * Where a frame of the whole timeline falls in the video this version plays. Inside a clip that is
 * left out, that is where the next clip played starts — what playing from there would show.
 */
export function toPlayFrame(timeline: Clip[], leftOut: readonly string[], frame: number): number {
  if (leftOut.length === 0) return frame
  const out = new Set(leftOut)
  let removed = 0
  for (const clip of [...timeline].sort((a, b) => a.start - b.start)) {
    if (frame < clip.start) break
    if (!out.has(clip.id)) continue
    if (frame < clip.start + clip.duration) return clip.start - removed
    removed += clip.duration
  }
  return frame - removed
}

/** Where a frame of the video this version plays falls on the whole timeline. */
export function toEditFrame(timeline: Clip[], leftOut: readonly string[], frame: number): number {
  if (leftOut.length === 0) return frame
  const out = new Set(leftOut)
  let removed = 0
  for (const clip of [...timeline].sort((a, b) => a.start - b.start)) {
    if (!out.has(clip.id)) {
      if (frame + removed < clip.start + clip.duration) break
      continue
    }
    // A left-out clip that starts at or before this point in the video is skipped over.
    if (clip.start <= frame + removed) removed += clip.duration
    else break
  }
  return frame + removed
}

/** A version name as it should be kept: trimmed, and different from the others'. */
export function uniqueVersionName(name: string, versions: Versions, ignoring?: string): string {
  const base = name.trim() || 'Version'
  const taken = new Set(versions.versions.filter((version) => version.id !== ignoring).map((version) => version.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`
}
