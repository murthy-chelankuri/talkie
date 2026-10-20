import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { launchTalkie, openProject, type Talkie } from './app'
import { makeFixture, type Fixture } from './fixture'
import { addScene, addTranscriptSegment, moveTimelineItem } from '../src/main/project/projectApi'
import { projectsRootDir } from '../src/main/project/paths'
import type { TimelineItem } from '../src/main/project/timeline/schema'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

function projectDir(): string {
  const root = projectsRootDir(fixture.home)
  return join(root, readdirSync(root).find((entry) => entry.startsWith(fixture.projectId))!)
}

const timeline = (): TimelineItem[] => JSON.parse(readFileSync(join(projectDir(), 'timeline.json'), 'utf8'))

/**
 * A project themed by a Talkie from before the cards were HTML: classic slides with the card
 * layouts at either end, and the project marked as having had its cards.
 */
function withClassicCards(): { opening: string; closing: string } {
  const card = { bullets: [], style: { theme: 'brand', align: 'center' } }
  const opening = addScene(fixture.projectId, 'scene', { ...card, title: 'End to end', layout: 'title' }, fixture.home)
  moveTimelineItem(fixture.projectId, opening.id, 1, fixture.home)
  addTranscriptSegment(fixture.projectId, { text: 'Welcome to the video.', timelineItemId: opening.id }, fixture.home)
  const closing = addScene(fixture.projectId, 'scene', { ...card, title: 'Thanks for watching', layout: 'closing' }, fixture.home)
  const path = join(projectDir(), 'project.json')
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), themeId: 'builtin-sand', bookendsAdded: true }))
  return { opening: opening.id, closing: closing.id }
}

/** Choose a theme the way a person does: the Project panel, About this project, Theme. */
async function chooseTheme(win: Talkie['win'], themeId: string): Promise<void> {
  const about = win.getByRole('button', { name: /About this project/ })
  if (!(await about.isVisible())) await win.getByRole('tab', { name: 'Project', exact: true }).click()
  await about.click()
  await win.getByRole('combobox', { name: 'Theme' }).selectOption(themeId)
}

describe('the cards at either end', () => {
  it('become HTML cards when a theme is applied, and follow the next theme', async () => {
    fixture = makeFixture('system')
    const cards = withClassicCards()
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await openProject(win)

    await chooseTheme(win, 'builtin-midnight')

    // Made HTML where they stood: the same clips, so the opening card keeps its narration.
    await expect.poll(() => timeline().filter((item) => item.kind === 'html').map((item) => item.id), { timeout: 30_000 }).toEqual([cards.opening, cards.closing])
    const transcript = JSON.parse(readFileSync(join(projectDir(), 'transcript.json'), 'utf8')) as { timelineItemId: string }[]
    expect(transcript.some((segment) => segment.timelineItemId === cards.opening)).toBe(true)
    expect((timeline()[0].data as { params: { title: string } }).params.title).toBe('End to end')

    // The opening card plays as a page, saying the project's name in the theme's colours.
    await win.getByRole('button', { name: 'Close', exact: true }).click()
    await win.getByRole('button', { name: 'Play', exact: true }).click()
    const page = win.frameLocator('iframe').first()
    await expect.poll(() => page.locator('#title').textContent().catch(() => null), { timeout: 15_000 }).toBe('End to end')
    const background = (): Promise<string> => page.locator('html').evaluate((html) => getComputedStyle(html).getPropertyValue('--talkie-bg').trim())
    const midnight = await background()
    await win.getByRole('button', { name: 'Pause', exact: true }).click()

    // Another theme restyles the cards it has rather than adding more.
    await chooseTheme(win, 'builtin-daylight')
    await win.getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(background, { timeout: 15_000 }).not.toBe(midnight)
    expect(timeline().filter((item) => (item.data as { card?: string }).card)).toHaveLength(2)
  }, 120_000)
})
