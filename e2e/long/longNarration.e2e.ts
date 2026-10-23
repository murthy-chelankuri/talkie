import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, openProject, takePath, transcriptOnDisk, type Talkie } from '../app'
import { takeShape } from '../audio'
import { kokoroAvailable, makeFixture, PROJECT_NAME, type Fixture } from '../fixture'
import { addScene, addTranscriptSegment } from '../../src/main/project/projectApi'
import { exportedVideo, projectOnDisk, voicedClipsInExport } from './exported'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

/** About 310 words, 85 seconds read: far past the 510 phonemes Kokoro reads at once. */
const paragraph = (topic: string): string =>
  `This scene is about ${topic}, and it has a great deal to say. ` +
  Array.from(
    { length: 9 },
    (_, i) =>
      `Point ${i + 1} about ${topic}: the team looked at how people really use it every day, found the slow parts, and made each of them quicker, clearer and easier to explain to someone new.`
  ).join(' ')

/**
 * The way people actually narrate: a lot of words in each of several scenes, all spoken at once,
 * then exported. Each piece of this broke separately and was only found this way — Kokoro dropped
 * everything past its 510-phoneme limit; it read some sentences as silence, which hid inside a long
 * take; and "Speak all" gave up at the first failure, leaving every later scene silent. The take
 * on disk and the video can disagree, so both are measured. af_alloy is the fixture's voice and
 * the one that read four of these ten sentences as silence.
 */
describe('long narration across many scenes', () => {
  it.skipIf(!kokoroAvailable())('is spoken in full in Kokoro and heard all the way through the export', async () => {
    fixture = makeFixture({ kokoro: true })
    for (const topic of ['planning', 'reporting', 'onboarding', 'support']) {
      const item = addScene(fixture.projectId, 'scene', { title: topic, bullets: ['One', 'Two'] }, fixture.home)
      addTranscriptSegment(fixture.projectId, { text: paragraph(topic), timelineItemId: item.id }, fixture.home)
    }
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await openProject(win)

    await win.getByRole('button', { name: /^Speak \d+ clips$/ }).click()
    await win.getByRole('button', { name: '1 clip needs words' }).waitFor({ timeout: 20 * 60_000 })

    for (const segment of transcriptOnDisk(fixture).filter((each) => each.text.trim())) {
      expect(segment.status, segment.text.slice(0, 40)).toBe('narrated')
      const take = takeShape(takePath(fixture, segment))
      const words = segment.text.split(/\s+/).length
      expect((words / take.seconds) * 60, `${segment.text.slice(0, 40)}: words a minute`).toBeLessThan(260)
      expect(take.longestSilence, `${segment.text.slice(0, 40)}: silence inside the take`).toBeLessThan(2.5)
    }

    await win.getByRole('button', { name: 'Export video' }).click()
    await win.getByText('Video exported').waitFor({ timeout: 20 * 60_000 })

    const { dir, clips, takes } = projectOnDisk(fixture.home, PROJECT_NAME)
    for (const { clip, heard } of voicedClipsInExport(exportedVideo(dir), clips, takes)) {
      expect(heard.rms, `clip at ${clip.start} is silent in the export`).toBeGreaterThan(0.01)
      expect(heard.longestSilence, `clip at ${clip.start} goes quiet in the export`).toBeLessThan(2.5)
    }
  }, 45 * 60_000)
})
