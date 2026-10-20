import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchTalkie, openProject, takePath, transcriptOnDisk, type Talkie } from './app'
import { makeFixture, type Fixture } from './fixture'
import { writeRoomyTake } from '../src/main/transcript/testTakes'
import { measureTakeLevels } from '../src/main/transcript/cleanVoice'
import type { TranscriptSegment } from '../src/main/transcript/schema'

let fixture: Fixture
let talkie: Talkie
let micDir: string

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  if (micDir) rmSync(micDir, { recursive: true, force: true })
  expect(errors, 'the window logged errors').toEqual([])
})

/**
 * How far the voice stands above the room. Read from the take's own quietest and loudest moments
 * rather than fixed times: when the fake microphone starts playing is Chromium's business.
 */
async function voiceOverRoom(path: string): Promise<number> {
  const levels = await measureTakeLevels(path)
  if (!levels) throw new Error(`${path} had nothing to measure`)
  return levels.voiceDb - levels.floorDb
}

describe('recording narration in your own voice', () => {
  it('cleans the room out of a take, and switches back to it as heard', async () => {
    // Chromium's fake microphone plays a spoken line over a fan and mains hum, round and round —
    // played once, the quietest moments of the take were the silence after it, not the room.
    micDir = mkdtempSync(join(tmpdir(), 'talkie-mic-'))
    const mic = join(micDir, 'room.wav')
    await writeRoomyTake(mic, 0.04)

    fixture = makeFixture('system')
    talkie = await launchTalkie(fixture, {
      // The sandbox, here only: the fake microphone reads its file from inside the sandboxed
      // process, which Chromium refuses ("Try disabling the sandbox"), and it records silence.
      // Every other run keeps it; this one is about the voice, not the sandbox.
      switches: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-audio-capture=${mic}`,
        '--no-sandbox'
      ]
    })
    // macOS asks about the microphone for the app, and nobody is there to answer.
    await talkie.app.evaluate(({ systemPreferences }) => {
      systemPreferences.getMediaAccessStatus = () => 'granted'
    })
    const { win } = talkie
    await openProject(win)

    await win.getByRole('button', { name: /^Record .* in your own voice$/ }).first().click()
    await win.waitForTimeout(8_000)
    await win.getByRole('button', { name: /^Stop recording/ }).first().click()

    const recorded = (): TranscriptSegment | undefined =>
      transcriptOnDisk(fixture).find((segment) => segment.voice === 'your own voice')
    await expect.poll(() => recorded()?.recording?.cleaned, { timeout: 60_000, interval: 500 }).toBe(true)

    const cleaned = recorded()!
    const original = join(takePath(fixture, cleaned), '..', cleaned.recording!.original)
    const gained = (await voiceOverRoom(takePath(fixture, cleaned))) - (await voiceOverRoom(original))
    // Between 4.5 and 9 dB here, since where the fake microphone's loop starts moves the room
    // about in the take — and the browser has already taken some out. That the clean-up holds up
    // on a fixed take is recordNarration.test.ts's to say; this is that the app gets it there.
    expect(gained, 'how much further the voice stands above the room once cleaned').toBeGreaterThan(3)

    // The inspector follows the timeline's selection.
    await win.locator('[aria-roledescription="sortable"]').first().click()
    const toggle = win.getByRole('switch', { name: 'Clean up my voice' })
    await expect.poll(() => toggle.isChecked(), { timeout: 10_000 }).toBe(true)
    await toggle.click()

    await expect.poll(() => recorded()?.recording?.cleaned, { timeout: 60_000, interval: 500 }).toBe(false)
    const asHeard = recorded()!
    expect(asHeard.audioFile).not.toBe(cleaned.audioFile)
    expect(Math.abs((await voiceOverRoom(takePath(fixture, asHeard))) - (await voiceOverRoom(original)))).toBeLessThan(3)
  }, 180_000)
})
