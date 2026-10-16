import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, type Talkie } from './app'
import { makeFixture, type Fixture } from './fixture'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

/**
 * Every clip still draws in the preview after one is dragged somewhere else.
 *
 * The window is handed media as asset-server addresses, since it cannot load the files themselves;
 * the timeline read on opening was given them, and the one handed back after a drag was not. So a
 * drag left every recording, picture, diagram and HTML scene pointing at a bare file path, blank,
 * while slides — which have no media — went on drawing and made it look like some scenes had
 * simply stopped working.
 */
describe('dragging a clip', () => {
  it('leaves every clip showing in the preview, wherever it was dragged to', async () => {
    fixture = makeFixture()
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await win.getByRole('button', { name: 'Open Taskboard walkthrough' }).click()
    await win.getByRole('tablist', { name: 'Ways to work on this project' }).waitFor()

    const root = join(fixture.home, 'Talkie', 'Projects')
    const dir = readdirSync(root)
      .map((entry) => join(root, entry))
      .find((each) => JSON.parse(readFileSync(join(each, 'project.json'), 'utf8')).name === 'Taskboard walkthrough')!
    const order = (): string[] =>
      (JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8')) as { id: string; start: number }[])
        .sort((a, b) => a.start - b.start)
        .map((clip) => clip.id)
    const dragged = order()[1]

    // The second clip, a recording, dragged past the last, in small steps as a hand moves.
    const clips = win.locator('[aria-roledescription="sortable"]')
    const count = await clips.count()
    const from = (await clips.nth(1).boundingBox())!
    const to = (await clips.nth(count - 1).boundingBox())!
    await win.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await win.mouse.down()
    const endX = to.x + to.width - 4
    for (let step = 1; step <= 25; step += 1) {
      await win.mouse.move(from.x + from.width / 2 + ((endX - from.x - from.width / 2) * step) / 25, from.y + from.height / 2)
      await win.waitForTimeout(16)
    }
    await win.mouse.up()
    await win.waitForTimeout(500)

    // It did move: on disk, the recording that was second is now last.
    expect(order().indexOf(dragged)).toBe(count - 1)

    // Every clip in turn, from the start: what the player shows of it has loaded.
    await win.getByRole('slider', { name: 'Playback position' }).click({ position: { x: 1, y: 5 } })
    const blank: string[] = []
    for (let clip = 0; clip < count; clip += 1) {
      await win.waitForTimeout(700)
      const shown = await win.evaluate(() => {
        const stage = document.querySelector('.aspect-video')
        const media = Array.from(stage?.querySelectorAll('video, img, iframe') ?? []).filter((el) =>
          (el as HTMLElement).checkVisibility({ visibilityProperty: true })
        )
        return media.map((el) => ({
          tag: el.tagName,
          src: (el as HTMLMediaElement).currentSrc || (el as HTMLImageElement).src,
          loaded:
            el instanceof HTMLVideoElement ? el.readyState >= 2 : el instanceof HTMLImageElement ? el.complete && el.naturalWidth > 0 : true
        }))
      })
      for (const each of shown) {
        if (!each.loaded || !each.src.startsWith('http://127.0.0.1')) blank.push(`clip ${clip + 1}: ${each.tag} ${each.src.slice(0, 80)}`)
      }
      const next = win.getByRole('button', { name: 'Next clip' })
      if (await next.isEnabled()) await next.click()
    }
    expect(blank).toEqual([])
  }, 120_000)
})
