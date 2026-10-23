import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, openProject, type Talkie } from './app'
import { makeFixtureWithCut, type Fixture } from './fixture'
import { sharedSettingsPath, studioDir } from '../src/main/studio/studio'
import { settingsPath } from '../src/main/settings/settingsStore'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

/**
 * Lay the fixture out as a Talkie from before the Studio left it: projects and their full paths in
 * ~/Talkie/Projects, every setting — shared and private — in settings.json.
 */
function asBeforeTheStudio(home: string): string {
  const before = join(home, 'Talkie', 'Projects')
  renameSync(join(studioDir(home), 'Projects'), before)
  const dir = join(before, readdirSync(before)[0])

  const timeline = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8')) as { data: { src?: string } }[]
  for (const clip of timeline) if (clip.data.src && !clip.data.src.startsWith('/')) clip.data.src = join(dir, clip.data.src)
  writeFileSync(join(dir, 'timeline.json'), JSON.stringify(timeline, null, 2))
  const project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...project, schemaVersion: 1 }, null, 2))

  const shared = JSON.parse(readFileSync(sharedSettingsPath(home), 'utf8'))
  const local = JSON.parse(readFileSync(settingsPath(home), 'utf8'))
  writeFileSync(settingsPath(home), JSON.stringify({ ...local, ...shared, narration: { ...local.narration, anthropic: { apiKey: 'sk-ant-kept-here', model: '' } } }))
  rmSync(studioDir(home), { recursive: true, force: true })
  return dir
}

describe('the Studio', () => {
  it('takes in a Talkie from before it, and the projects still play', async () => {
    fixture = await makeFixtureWithCut()
    const before = asBeforeTheStudio(fixture.home)
    expect(readFileSync(join(before, 'timeline.json'), 'utf8')).toContain(fixture.home)

    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await openProject(win)

    // The recording, found where it now is.
    await expect.poll(() => win.evaluate(() => document.querySelector('video')?.readyState ?? 0), { timeout: 15_000 }).toBeGreaterThanOrEqual(2)

    const moved = join(studioDir(fixture.home), 'Projects', before.split('/').pop()!)
    expect(existsSync(before)).toBe(false)
    expect(readFileSync(join(moved, 'timeline.json'), 'utf8')).not.toContain(fixture.home)
    expect(JSON.parse(readFileSync(join(moved, 'project.json'), 'utf8')).schemaVersion).toBe(2)
    expect(readFileSync(join(studioDir(fixture.home), '.gitignore'), 'utf8')).toContain('Projects/*/renders/')
    // The voice went with the Studio; the key stayed with the Mac.
    expect(readFileSync(sharedSettingsPath(fixture.home), 'utf8')).toContain('"engine": "kokoro"')
    expect(readFileSync(sharedSettingsPath(fixture.home), 'utf8')).not.toContain('sk-ant-kept-here')
    expect(readFileSync(settingsPath(fixture.home), 'utf8')).toContain('sk-ant-kept-here')
  }, 120_000)

  it('says in Settings where the Studio is and how to put it in git', async () => {
    fixture = await makeFixtureWithCut()
    talkie = await launchTalkie(fixture)
    const { win } = talkie

    await win.getByRole('button', { name: 'Settings' }).click()
    const settings = win.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: /^System/ }).click()
    const studio = settings.getByRole('region', { name: 'Studio' })
    await studio.getByText('Not in git yet.').waitFor()
    expect(await studio.getByLabel('Commands to put the Studio in git').textContent()).toContain('cd ~/Talkie/Studio')
    if (process.env.TALKIE_SHOT) await studio.screenshot({ path: process.env.TALKIE_SHOT })
  }, 90_000)
})
