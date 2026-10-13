import { describe, expect, it } from 'vitest'
import { filmAndCut } from './tour/tour'

/**
 * Films the tour on its own — `TOUR=1 npm run examples:rebuild` — for working on it a step at a time
 * with TOUR_UNTIL, or on the cut with TOUR_REUSE. The Meet Talkie story reuses the footage it
 * ships with, and films again only with REFILM=1.
 */
describe.runIf(process.env.TOUR)('the tour', () => {
  it('is filmed and cut', async () => {
    const cuts = await filmAndCut()
    console.log([...cuts.values()].map((cut) => `${cut.name}: ${cut.seconds.toFixed(1)}s`).join('\n'))
    expect(cuts.size).toBeGreaterThan(0)
  })
})
