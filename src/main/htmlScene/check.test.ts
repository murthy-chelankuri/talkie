import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { createProject } from '../project/projectApi'
import { projectsRootDir } from '../project/paths'
import { closeAssetServer } from '../render/assetServer'
import { BUILTIN_THEMES } from '../themes/builtinThemes'
import { renderThemeFrom } from '../themes/toRenderTheme'
import { checkHtmlScene, sceneThemeFor, type CheckRequest } from './check'
import { writeRevision } from './store'
import { EMPTY, GOOD, HARD_CODED, HOSTILE, NAVIGATES, OVERFLOW, PER_TICK, SILENT } from './fixtures'

let baseDir: string
let projectId: string
beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-html-check-'))
  projectId = createProject('Checks', baseDir).id
})
afterAll(async () => {
  await closeAssetServer()
  rmSync(baseDir, { recursive: true, force: true })
})

const theme = sceneThemeFor(renderThemeFrom(BUILTIN_THEMES[0], undefined), 'dark')
const check = (html: string, extra: Partial<CheckRequest> = {}) =>
  checkHtmlScene({
    src: writeRevision(projectId, { 'index.html': html }, { baseDir }),
    durationFrames: 90,
    theme,
    rootDir: projectsRootDir(baseDir),
    ...extra
  })

describe('checking an HTML scene', () => {
  it('returns the frames asked for, drawn at those moments, and finds nothing wrong with a good one', async () => {
    const result = await check(GOOD, { atSeconds: [0, 1, 2] })

    expect(result.problems).toEqual([])
    expect(result.frames.map((f) => f.atSeconds)).toEqual([0, 1, 2])
    expect(result.frames[0].png.equals(result.frames[1].png)).toBe(false)
    expect(result.visibleText).toContain('Revenue')
  }, 120_000)

  it('lets nothing out of the sandbox, and names what it tried', async () => {
    const result = await check(HOSTILE, { atSeconds: [0.5] })

    expect(result.visibleText).not.toContain('ok:')
    expect(result.visibleText).toContain('no:parent')
    expect(result.visibleText).toContain('no:webrtc')
    expect(result.problems.join('\n')).toMatch(/connect-src/)
    expect(result.problems.join('\n')).toMatch(/img-src/)
  }, 120_000)

  it('keeps a scene from leaving its page, and says it tried', async () => {
    const result = await check(NAVIGATES, { atSeconds: [0] })

    expect(result.problems.join('\n')).toMatch(/tried to leave its page/)
    expect(result.visibleText).not.toContain('Example Domain')
  }, 120_000)

  it('reports a colour the theme did not give it', async () => {
    const result = await check(HARD_CODED, { atSeconds: [0] })

    expect(result.problems.join('\n')).toMatch(/#ff0000.*--talkie-heading/)
  }, 120_000)

  it('reports animation that depends on the order frames are drawn in', async () => {
    const result = await check(PER_TICK, { atSeconds: [0] })

    expect(result.problems.join('\n')).toMatch(/order/)
  }, 120_000)

  it('captures a frame the page never finishes, and says so', async () => {
    const result = await check(SILENT, { atSeconds: [0], durationFrames: 30 })

    expect(result.frames).toHaveLength(1)
    expect(result.problems.join('\n')).toMatch(/not drawn within 5 s/)
  }, 120_000)

  it('reports text running out of the frame, and a frame of one colour', async () => {
    expect((await check(OVERFLOW, { atSeconds: [0] })).problems.join('\n')).toMatch(/runs out of the frame/)
    expect((await check(EMPTY, { atSeconds: [0] })).problems.join('\n')).toMatch(/blank/)
  }, 120_000)

  it('writes the poster and reads the words on it', async () => {
    const src = writeRevision(projectId, { 'index.html': GOOD }, { baseDir })
    const posterTo = join(dirname(src), 'poster.png')

    const result = await checkHtmlScene({ src, durationFrames: 90, theme, rootDir: projectsRootDir(baseDir), atSeconds: [], posterTo })

    expect(existsSync(posterTo)).toBe(true)
    expect(result.visibleText).toContain('Revenue')
  }, 120_000)
})
