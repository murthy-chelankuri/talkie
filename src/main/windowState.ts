import { homedir } from 'os'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import { ROOT_NAME } from './project/migrateStorageRoot'
import { writeJsonAtomic } from './project/atomicWrite'

/**
 * Below this the editor stops being usable: the rail, the preview and the timeline all have to
 * fit, and the narration boxes under the clips need room to be written in.
 */
export const MIN_WIDTH = 1024
export const MIN_HEIGHT = 700

/** How much of a screen a fresh install takes. Not all of it — it is a window, not a kiosk. */
const FIRST_RUN_FRACTION = 0.88

export interface Bounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

const BoundsSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().min(MIN_WIDTH),
  height: z.number().min(MIN_HEIGHT)
})

export function windowStatePath(baseDir: string = homedir()): string {
  return join(baseDir, ROOT_NAME, 'window.json')
}

/**
 * The size to open at when nothing has been remembered: most of the screen, so a video editor
 * does not start in a box a third of the display with its preview letterboxed.
 */
export function firstRunBounds(workArea: WorkArea): Bounds {
  const width = Math.max(MIN_WIDTH, Math.round(workArea.width * FIRST_RUN_FRACTION))
  const height = Math.max(MIN_HEIGHT, Math.round(workArea.height * FIRST_RUN_FRACTION))

  return {
    width: Math.min(width, workArea.width),
    height: Math.min(height, workArea.height),
    x: workArea.x + Math.round((workArea.width - Math.min(width, workArea.width)) / 2),
    y: workArea.y + Math.round((workArea.height - Math.min(height, workArea.height)) / 2)
  }
}

/**
 * Bring remembered bounds back onto a screen that still exists.
 *
 * A window saved on a second monitor, or on a larger one, would otherwise reopen off the edge
 * of the display and be unreachable — with no way to get it back but deleting the file.
 */
export function confineToWorkArea(bounds: Bounds, workArea: WorkArea): Bounds {
  const width = Math.min(Math.max(bounds.width, MIN_WIDTH), workArea.width)
  const height = Math.min(Math.max(bounds.height, MIN_HEIGHT), workArea.height)

  if (bounds.x === undefined || bounds.y === undefined) return { width, height }

  return {
    width,
    height,
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - height)
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

export function readWindowState(baseDir: string = homedir()): Bounds | null {
  const path = windowStatePath(baseDir)
  if (!existsSync(path)) return null

  try {
    return BoundsSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
  } catch {
    // A window that will not open is worse than one that opens in the wrong place.
    return null
  }
}

export function saveWindowState(bounds: Bounds, baseDir: string = homedir()): void {
  try {
    const path = windowStatePath(baseDir)
    mkdirSync(dirname(path), { recursive: true })
    writeJsonAtomic(path, bounds)
  } catch (err) {
    console.error('Could not remember the window size:', err)
  }
}

/** Where to open: what was remembered, brought back on screen, or most of the display. */
export function openingBounds(workArea: WorkArea, baseDir: string = homedir()): Bounds {
  const remembered = readWindowState(baseDir)
  return remembered ? confineToWorkArea(remembered, workArea) : firstRunBounds(workArea)
}
