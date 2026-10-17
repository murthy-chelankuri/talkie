import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, openProject, transcriptOnDisk, type Talkie } from './app'
import { makeFixture, type Fixture } from './fixture'
import { addScene, addTranscriptSegment, updateTranscriptSegmentText } from '../src/main/project/projectApi'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

/**
 * An agent working over MCP writes the project from another process. This test is that process:
 * the same functions the MCP server calls, writing the same files while the app has them open.
 * The editor used to show none of it until the project was shut and opened again.
 */
describe('a project changed while it is open', () => {
  it('shows a scene an agent added, without being asked', async () => {
    fixture = makeFixture()
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await openProject(win)
    await win.getByRole('tab', { name: 'Script' }).click()
    await win.getByRole('region', { name: 'Scene 3' }).waitFor()

    const slide = addScene(fixture.projectId, 'scene', { title: 'From the agent', bullets: ['Written elsewhere'] }, fixture.home)
    addTranscriptSegment(fixture.projectId, { text: 'An agent wrote this scene.', timelineItemId: slide.id }, fixture.home)

    const added = win.getByRole('region', { name: 'Scene 4' })
    await expect.poll(() => added.getByRole('textbox', { name: 'Narration for scene 4' }).inputValue(), { timeout: 10_000 }).toBe(
      'An agent wrote this scene.'
    )
    await win.getByRole('status').filter({ hasText: 'from outside Talkie' }).waitFor()
    if (process.env.TALKIE_SHOT) await win.screenshot({ path: process.env.TALKIE_SHOT })
  }, 90_000)

  it('picks up changed words on Reload, and does not count its own saves as anyone else’s', async () => {
    fixture = makeFixture()
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await openProject(win)
    await win.getByRole('tab', { name: 'Script' }).click()

    // The app's own save: no note that anything changed outside it.
    const third = win.getByRole('region', { name: 'Scene 3' })
    await third.getByRole('textbox', { name: 'Narration for scene 3' }).fill('Typed in the app.')
    await third.getByText('Saved').waitFor()
    await win.waitForTimeout(1000)
    expect(await win.getByRole('status').filter({ hasText: 'outside Talkie' }).count()).toBe(0)

    const first = transcriptOnDisk(fixture)[0]
    updateTranscriptSegmentText(fixture.projectId, first.id, 'Rewritten by an agent.', fixture.home)
    await win.getByRole('button', { name: 'Reload from disk' }).click()

    await expect
      .poll(() => win.getByRole('region', { name: 'Scene 1' }).getByRole('textbox', { name: 'Narration for scene 1' }).inputValue(), { timeout: 10_000 })
      .toBe('Rewritten by an agent.')
  }, 90_000)
})
