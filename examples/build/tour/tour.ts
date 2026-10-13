import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { serveApp } from '../serveApp'
import { cutFootage, type Cut } from './cutFootage'
import { filmTour } from './filmTour'
import { tourHome } from './tourHome'

/** Where a filming leaves its video and cuts. Not shipped; only the cuts a story uses are. */
export const TOUR_DIR = join(__dirname, '..', '..', '.tour')

/**
 * Film the tour and cut it into one clip per shot, by name.
 *
 * `TOUR_REUSE=1` cuts the last filming again instead — eight minutes of filming is a lot to
 * repeat for a change to the words — and `TOUR_UNTIL` stops the filming after a shot.
 */
export async function filmAndCut(): Promise<Map<string, Cut>> {
  const shotsFile = join(TOUR_DIR, 'video', 'shots.json')
  if (process.env.TOUR_REUSE && existsSync(shotsFile)) {
    return byName(await cutFootage(JSON.parse(readFileSync(shotsFile, 'utf-8')), join(TOUR_DIR, 'cuts')))
  }

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

function byName(cuts: Cut[]): Map<string, Cut> {
  return new Map(cuts.map((cut) => [cut.name, cut]))
}
