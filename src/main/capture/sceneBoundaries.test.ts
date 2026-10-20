import { describe, expect, it } from 'vitest'
import { IDLE_GAP_MS, MIN_SCENE_MS, SNAP_MS, TARGET_SCENE_MS, planFootageScenes, planScenes } from './sceneBoundaries'
import type { ActionLogEntry } from './actionLog'

function click(t: number): ActionLogEntry {
  return { t, type: 'click', selector: '#go' }
}

function navigation(t: number, url = 'https://example.com/next'): ActionLogEntry {
  return { t, type: 'navigation', url }
}

/** A steady patter of clicks, so a stretch has no quiet moment of its own to be cut on. */
function busy(fromMs: number, toMs: number, everyMs = 1000): ActionLogEntry[] {
  const entries: ActionLogEntry[] = []
  for (let t = fromMs; t < toMs; t += everyMs) entries.push(click(t))
  return entries
}

describe('cutting a recorded session into scenes', () => {
  it('leaves a short recording as the single clip it always was', () => {
    // Narration for one short clip was never the problem, and cutting a nine-second demo into
    // two would cost it a cut and gain it nothing.
    const scenes = planScenes(9000, [navigation(3000), click(6000)])

    expect(scenes).toHaveLength(1)
    expect(scenes[0]).toMatchObject({ fromMs: 0, durationMs: 9000 })
  })

  it('starts a new scene where the person moved to another tab', () => {
    const scenes = planScenes(40_000, busy(0, 40_000), [20_000])

    expect(scenes.map((scene) => scene.fromMs)).toContain(20_000)
    expect(scenes.find((scene) => scene.fromMs === 20_000)?.because).toBe('page')
  })

  it('ends a scene on the wait it caused rather than opening the next one with it', () => {
    // "I press run, and it thinks for a moment" is one thought. Cutting at the start of the
    // wait would open the next scene on a still screen with nothing yet to say about it.
    const scenes = planScenes(40_000, [
      ...busy(0, 12_000),
      // Sixteen seconds of an analysis coming back, then things happen again.
      ...busy(28_000, 40_000)
    ])

    expect(scenes.map((scene) => scene.fromMs)).toContain(28_000)
    expect(scenes.find((scene) => scene.fromMs === 28_000)?.because).toBe('wait')
  })

  it('never makes a scene too short to be seen and spoken over', () => {
    // A navigation a second after a click is the same moment twice, not two scenes.
    const entries = Array.from({ length: 40 }, (_, index) => navigation(index * 900, `https://x.test/${index}`))
    const scenes = planScenes(40_000, entries)

    for (const scene of scenes) expect(scene.durationMs).toBeGreaterThanOrEqual(MIN_SCENE_MS)
  })

  it('prefers the stronger reason when two fall close together', () => {
    // A lull and then, two seconds later, the page changes. Both describe one break, and the
    // navigation is the one a viewer would recognise as the start of something.
    const scenes = planScenes(40_000, [
      ...busy(0, 8000),
      click(8000 + IDLE_GAP_MS + 500),
      navigation(8000 + IDLE_GAP_MS + 2500),
      ...busy(20_000, 40_000)
    ])

    const cut = scenes.find((scene) => scene.because !== 'start')
    expect(cut?.because).toBe('navigation')
  })

  it('comes round on the clock even while nothing in particular is happening', () => {
    // The cadence is what bounds how far the words can drift before they are put back in step,
    // so it cannot depend on the demo obliging with an event.
    const scenes = planScenes(90_000, [])

    expect(scenes.length).toBeGreaterThan(1)
    for (const scene of scenes) {
      expect(scene.durationMs).toBeLessThanOrEqual(TARGET_SCENE_MS + SNAP_MS)
    }
    expect(scenes.slice(0, -1).every((scene) => scene.because === 'start' || scene.because === 'clock')).toBe(true)
  })

  it('moves the cut off the beat onto a real moment nearby', () => {
    // A boundary two seconds early that lands on a page change is worth more than one exactly
    // on the beat that lands halfway through a click.
    const nearBeat = TARGET_SCENE_MS - 2000
    const scenes = planScenes(60_000, [...busy(0, 60_000), navigation(nearBeat)])

    expect(scenes[1].fromMs).toBe(nearBeat)
    expect(scenes[1].because).toBe('navigation')
  })

  it('cuts on a break the person made rather than waiting for the beat', () => {
    // Moving to another tab is the start of something. Holding the cut back to the clock would
    // bury it in the middle of a scene that is half one thing and half another.
    const scenes = planScenes(60_000, busy(0, 60_000), [7000])

    expect(scenes[1].fromMs).toBe(7000)
    expect(scenes[1].because).toBe('page')
  })

  it('cuts where the demo changes subject rather than waiting for the beat', () => {
    // A scene that is the tail of one subject and the head of the next cannot be narrated well
    // by anything downstream: it has two things to introduce and one breath to do it in.
    const scenes = planScenes(60_000, busy(0, 60_000), [], [8000])

    expect(scenes[1].fromMs).toBe(8000)
    expect(scenes[1].because).toBe('topic')
  })

  it('lets a change of subject win over a lull a moment earlier', () => {
    const scenes = planScenes(60_000, [...busy(0, 6000), ...busy(14_000, 60_000)], [], [14_500])

    const first = scenes[1]
    expect(first.because).toBe('topic')
    expect(first.fromMs).toBe(14_500)
  })

  it('still comes round on the clock between two distant changes of subject', () => {
    // The model is answering about subjects, not about drift. A forty-second stretch of one
    // subject still needs the words put back in step with the picture on the way through.
    const scenes = planScenes(90_000, busy(0, 90_000), [], [80_000])

    expect(scenes.length).toBeGreaterThan(2)
    for (const scene of scenes) {
      expect(scene.durationMs).toBeLessThanOrEqual(TARGET_SCENE_MS + SNAP_MS)
    }
  })

  it('accounts for every frame of the recording exactly once', () => {
    // The scenes all point at the same file and play their own stretch of it, so a gap would
    // lose footage and an overlap would play it twice.
    const scenes = planScenes(
      75_000,
      [...busy(0, 30_000), navigation(31_000), ...busy(40_000, 75_000)],
      [55_000],
      [22_000]
    )

    let cursor = 0
    for (const scene of scenes) {
      expect(scene.fromMs).toBe(cursor)
      cursor += scene.durationMs
    }
    expect(cursor).toBe(75_000)
  })
})

describe('cutting a video made elsewhere into scenes', () => {
  const none = { shotsMs: [], stillsEndMs: [], pausesMs: [] }

  it('cuts where the edit cut, rather than waiting for the beat', () => {
    const scenes = planFootageScenes(40_000, { ...none, shotsMs: [7000, 30_000] })

    expect(scenes.map((scene) => [scene.fromMs, scene.because])).toEqual([
      [0, 'start'],
      [7000, 'shot'],
      [22_000, 'clock'],
      [30_000, 'shot']
    ])
  })

  it('takes a cut in the last stretch, where a whole scene is left either side of it', () => {
    // Twenty seconds left is one scene by the clock; a cut the editor made in it is still a cut.
    const scenes = planFootageScenes(20_000, { ...none, shotsMs: [8000] })

    expect(scenes.map((scene) => scene.fromMs)).toEqual([0, 8000])
  })

  it('lands a cut between sentences rather than on the clock in the middle of one', () => {
    const scenes = planFootageScenes(40_000, { ...none, pausesMs: [13_200, 31_000] })

    expect(scenes[1]).toMatchObject({ fromMs: 13_200, because: 'pause' })
  })

  it('leaves a short video as one scene, whatever cuts it has', () => {
    expect(planFootageScenes(8000, { ...none, shotsMs: [3000, 5000] })).toEqual([
      { fromMs: 0, durationMs: 8000, because: 'start' }
    ])
  })

  it('never makes a scene shorter than the shortest a scene may be, however fast the edit cuts', () => {
    const shotsMs = Array.from({ length: 30 }, (_, i) => (i + 1) * 2000)
    const scenes = planFootageScenes(62_000, { ...none, shotsMs })

    for (const scene of scenes) expect(scene.durationMs).toBeGreaterThanOrEqual(MIN_SCENE_MS)
  })
})

describe('the last stretch of a recording', () => {
  it('starts a new scene where the person moved to another tab near the end', () => {
    const scenes = planScenes(20_000, [navigation(2000)], [9000])

    expect(scenes.map((scene) => [scene.fromMs, scene.because])).toEqual([
      [0, 'start'],
      [9000, 'page']
    ])
  })
})
