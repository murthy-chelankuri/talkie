import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { EXAMPLES_DIR } from '../kit'
import { serveApp } from '../serveApp'
import { cutFootage, lengthMs, type Cut } from './cutFootage'
import { filmTour } from './filmTour'
import { tourHome } from './tourHome'

/** Where a filming leaves its video and cuts. Not shipped; only the cuts a story uses are. */
export const TOUR_DIR = join(__dirname, '..', '..', '.tour')

/** Where the shipped Meet Talkie keeps its footage: a folder per shot, `NN-name/clip.mp4`. */
const SHIPPED_FOOTAGE = join(EXAMPLES_DIR, 'meet-talkie', 'project', 'sources', 'tour')

/**
 * The tour's footage, one clip per shot, by name.
 *
 * The footage Meet Talkie already ships with, unless asked to film again: filming drives the app
 * on screen for about nine minutes, and most rebuilds are a change to the words. `REFILM=1` films
 * anew — after the app has changed how it looks — and `TOUR_REUSE=1` cuts the last filming again.
 * `TOUR_UNTIL` stops a filming after a shot.
 */
export async function filmAndCut(): Promise<Map<string, Cut>> {
  const shotsFile = join(TOUR_DIR, 'video', 'shots.json')
  if (process.env.TOUR_REUSE && existsSync(shotsFile)) {
    return byName(await cutFootage(JSON.parse(readFileSync(shotsFile, 'utf-8')), join(TOUR_DIR, 'cuts')))
  }
  if (!process.env.REFILM && !process.env.TOUR && existsSync(SHIPPED_FOOTAGE)) return shippedFootage()

  rmSync(TOUR_DIR, { recursive: true, force: true })
  mkdirSync(TOUR_DIR, { recursive: true })
  const { home, env, dispose } = await tourHome()
  const app = await serveApp('taskboard')
  try {
    return byName(await cutFootage(await filmTour(home, env, app.url, TOUR_DIR), join(TOUR_DIR, 'cuts')))
  } finally {
    await app.close()
    dispose()
  }
}

function shippedFootage(): Map<string, Cut> {
  return byName(
    readdirSync(SHIPPED_FOOTAGE)
      .sort()
      .map((dir) => {
        const path = join(SHIPPED_FOOTAGE, dir, 'clip.mp4')
        return { name: dir.replace(/^\d+-/, ''), path, seconds: lengthMs(path) / 1000 }
      })
  )
}

function byName(cuts: Cut[]): Map<string, Cut> {
  return new Map(cuts.map((cut) => [cut.name, cut]))
}
