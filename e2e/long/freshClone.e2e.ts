import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, type Talkie } from '../app'
import { makeFixture, type Fixture } from '../fixture'
import { exportedVideo, projectOnDisk, videoSeconds, voicedClipsInExport } from './exported'
import { FPS } from '../../src/composition/constants'

let fixture: Fixture
let talkie: Talkie
const scratch = mkdtempSync(join(tmpdir(), 'talkie-fresh-clone-'))
const clone = join(scratch, 'talkie')

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))

/**
 * What someone downloading Talkie goes through, from nothing: a clone, `npm ci` with its install
 * scripts, a build, and the app it makes. Everything else runs in a checkout that has been set up
 * for months, where the install steps never run again — and they are where a machine new to the
 * project failed: ffmpeg unpacking that hung with no reason given, export looking for files that
 * only a full build makes. Committed work only: the clone is of HEAD.
 */
describe('a fresh clone', () => {
  it('installs, builds, and exports an example with its sound', async () => {
    const root = join(__dirname, '..', '..')
    execFileSync('git', ['clone', '--quiet', root, clone])
    execFileSync('git', ['-C', clone, 'checkout', '--quiet', execFileSync('git', ['-C', root, 'rev-parse', 'HEAD']).toString().trim()])

    // As a person runs it: none of this run's npm settings leak into the clone's.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_')))
    const run = (args: string[]): void => {
      const result = spawnSync('npm', args, { cwd: clone, env, encoding: 'utf8', timeout: 15 * 60_000 })
      expect(result.status, `npm ${args.join(' ')}\n${result.stdout?.slice(-2000)}\n${result.stderr?.slice(-2000)}`).toBe(0)
    }
    run(['ci'])
    // The check `npm run dev` makes, which fails loudly if the install did not leave ffmpeg in
    // place. That it runs is the export's to show: it is that copy's ffmpeg the export uses.
    const ensured = spawnSync('node', ['scripts/fetchFfmpeg.mjs', '--ensure'], { cwd: clone, env, encoding: 'utf8' })
    expect(ensured.status, `ffmpeg is not in place after npm ci\n${ensured.stderr}`).toBe(0)
    run(['run', 'build'])

    fixture = makeFixture()
    talkie = await launchTalkie(fixture, { appDir: clone })
    const { win } = talkie
    await win.getByRole('button', { name: 'Open Taskboard walkthrough' }).click()
    await win.getByRole('tablist', { name: 'Ways to work on this project' }).waitFor()
    await win.getByRole('button', { name: 'Export video' }).click()
    await win.getByText('Video exported').waitFor({ timeout: 15 * 60_000 })

    const { dir, clips, takes } = projectOnDisk(fixture.home, 'Taskboard walkthrough')
    const video = exportedVideo(dir)
    const frames = clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0)
    expect(Math.abs(videoSeconds(video) - frames / FPS)).toBeLessThan(0.5)
    for (const { clip, heard } of voicedClipsInExport(video, clips, takes)) {
      expect(heard.rms, `${clip.kind} at frame ${clip.start} is silent`).toBeGreaterThan(0.01)
    }
  }, 45 * 60_000)
})
