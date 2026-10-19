import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { keepOutOfGit, moveIntoStudio, sharedSettingsPath, studioDir, STUDIO_GITIGNORE } from './studio'
import { createProject, importImage, readTimeline } from '../project/projectApi'
import { findProjectDir, projectsRootDir } from '../project/paths'
import { repairAssetPaths } from '../project/repairAssetPaths'
import { createTheme, readTheme, themesRootDir } from '../themes/themeApi'
import { defaultThemeDraft } from '../themes/schema'
import { moveSharedSettings, readSettings, settingsPath, updateSettings } from '../settings/settingsStore'
import { setProjectTheme } from '../themes/applyTheme'

let homes: string[] = []
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-studio-'))
  homes.push(dir)
  return dir
}

beforeEach(() => {
  homes = []
})

afterEach(() => {
  for (const dir of homes) rmSync(dir, { recursive: true, force: true })
})

/** What `git clone` of a Studio does, near enough: the folder, and nothing beside it. */
function cloneStudio(from: string, to: string): void {
  cpSync(studioDir(from), studioDir(to), { recursive: true })
}

describe('a Studio checked in on one Mac and cloned on another', () => {
  it('opens its projects there with every clip pointing at the files it brought', () => {
    const alice = home()
    const bob = home()
    const picture = join(alice, 'shot.png')
    writeFileSync(picture, 'png-bytes')
    const project = createProject('Checkout', alice)
    importImage(project.id, picture, alice)

    cloneStudio(alice, bob)

    const [clip] = readTimeline(project.id, bob)
    const src = (clip.data as { src: string }).src
    expect(src.startsWith(studioDir(bob))).toBe(true)
    expect(readFileSync(src, 'utf-8')).toBe('png-bytes')
    expect(readFileSync(join(findProjectDir(project.id, bob)!, 'timeline.json'), 'utf-8')).not.toContain(alice)
  })

  it('brings the project’s theme, from the library that travels with it', () => {
    const alice = home()
    const bob = home()
    const project = createProject('Branded', alice)
    const theme = createTheme({ ...defaultThemeDraft('Acme'), company: 'Acme' }, alice)
    setProjectTheme(project.id, theme.id, alice)

    cloneStudio(alice, bob)

    expect(readTheme(theme.id, bob).name).toBe('Acme')
  })

  it('brings the settings that shape a video, and leaves keys and tokens behind', () => {
    const alice = home()
    const bob = home()
    updateSettings(
      {
        speech: { engine: 'kokoro', voice: 'af_heart', pace: 170 },
        export: { burnCaptions: true },
        narration: { anthropic: { apiKey: 'sk-ant-secret' } },
        mcp: { enabled: true, tokenHash: 'hash-of-a-token' }
      },
      alice
    )

    cloneStudio(alice, bob)

    const shared = readFileSync(sharedSettingsPath(alice), 'utf-8')
    expect(shared).not.toContain('sk-ant-secret')
    expect(shared).not.toContain('hash-of-a-token')
    const there = readSettings(bob)
    expect(there.speech).toMatchObject({ engine: 'kokoro', voice: 'af_heart', pace: 170 })
    expect(there.export.burnCaptions).toBe(true)
    expect(there.narration.anthropic.apiKey).toBe('')
    expect(there.mcp.enabled).toBe(false)
  })

  it('opens a project from before relative paths, made under someone else’s home folder', () => {
    const alice = home()
    const bob = home()
    const picture = join(alice, 'shot.png')
    writeFileSync(picture, 'png-bytes')
    const project = createProject('Old', alice)
    importImage(project.id, picture, alice)
    // How a timeline was written before: the full path, into Alice's home.
    const dir = findProjectDir(project.id, alice)!
    const [clip] = readTimeline(project.id, alice)
    writeFileSync(join(dir, 'timeline.json'), JSON.stringify([{ ...clip, data: { src: (clip.data as { src: string }).src } }]))
    expect(readFileSync(join(dir, 'timeline.json'), 'utf-8')).toContain(alice)

    cloneStudio(alice, bob)
    repairAssetPaths(bob)

    const src = (readTimeline(project.id, bob)[0].data as { src: string }).src
    expect(readFileSync(src, 'utf-8')).toBe('png-bytes')
    const stored = readFileSync(join(findProjectDir(project.id, bob)!, 'timeline.json'), 'utf-8')
    expect(stored).not.toContain(alice)
    expect(JSON.parse(readFileSync(join(findProjectDir(project.id, bob)!, 'project.json'), 'utf-8')).schemaVersion).toBe(2)
  })
})

describe('moving into the Studio', () => {
  it('moves projects and themes out of ~/Talkie, and writes a .gitignore', () => {
    const base = home()
    mkdirSync(join(base, 'Talkie', 'Projects', 'p1-demo'), { recursive: true })
    mkdirSync(join(base, 'Talkie', 'Themes', 't1-acme'), { recursive: true })

    moveIntoStudio(base)

    expect(existsSync(join(projectsRootDir(base), 'p1-demo'))).toBe(true)
    expect(existsSync(join(themesRootDir(base), 't1-acme'))).toBe(true)
    expect(projectsRootDir(base)).toBe(join(studioDir(base), 'Projects'))
    expect(readFileSync(join(studioDir(base), '.gitignore'), 'utf-8')).toBe(STUDIO_GITIGNORE)
  })

  it('never merges two sets of projects: a Studio that has its own leaves the old folder alone', () => {
    const base = home()
    mkdirSync(join(base, 'Talkie', 'Projects', 'old-one'), { recursive: true })
    mkdirSync(join(studioDir(base), 'Projects', 'cloned-one'), { recursive: true })

    moveIntoStudio(base)

    expect(existsSync(join(base, 'Talkie', 'Projects', 'old-one'))).toBe(true)
    expect(existsSync(join(studioDir(base), 'Projects', 'old-one'))).toBe(false)
  })

  it('keeps a .gitignore someone has edited', () => {
    const base = home()
    mkdirSync(studioDir(base), { recursive: true })
    writeFileSync(join(studioDir(base), '.gitignore'), 'mine\n')

    moveIntoStudio(base)

    expect(readFileSync(join(studioDir(base), '.gitignore'), 'utf-8')).toBe('mine\n')
  })

  it('leaves an example out of git once, however often it is asked', () => {
    const base = home()

    keepOutOfGit('Projects/e1-taskboard', base)
    keepOutOfGit('Projects/e1-taskboard', base)

    const lines = readFileSync(join(studioDir(base), '.gitignore'), 'utf-8').split('\n')
    expect(lines.filter((line) => line === 'Projects/e1-taskboard/')).toHaveLength(1)
  })

  it('moves the shared settings out of settings.json, and keeps the private ones there', () => {
    const base = home()
    mkdirSync(join(base, 'Talkie'), { recursive: true })
    writeFileSync(
      settingsPath(base),
      JSON.stringify({ speech: { engine: 'kokoro', voice: 'af_heart' }, narration: { anthropic: { apiKey: 'sk-ant-secret' } } })
    )

    moveSharedSettings(base)

    expect(readFileSync(sharedSettingsPath(base), 'utf-8')).toContain('af_heart')
    const local = readFileSync(settingsPath(base), 'utf-8')
    expect(local).toContain('sk-ant-secret')
    expect(local).not.toContain('af_heart')
    expect(readSettings(base).speech.voice).toBe('af_heart')
  })
})
