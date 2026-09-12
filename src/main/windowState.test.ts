import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  firstRunBounds,
  confineToWorkArea,
  openingBounds,
  readWindowState,
  saveWindowState,
  windowStatePath,
  MIN_WIDTH,
  MIN_HEIGHT
} from './windowState'

const LAPTOP = { x: 0, y: 25, width: 1512, height: 945 }
const SMALL = { x: 0, y: 25, width: 1280, height: 720 }

describe('where the window opens', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-window-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('takes most of the screen on a first run, not a fixed box', () => {
    const bounds = firstRunBounds(LAPTOP)

    expect(bounds.width).toBeGreaterThan(1280)
    expect(bounds.width).toBeLessThanOrEqual(LAPTOP.width)
    expect(bounds.height).toBeLessThanOrEqual(LAPTOP.height)
  })

  it('centres itself in the space available', () => {
    const bounds = firstRunBounds(LAPTOP)

    const leftGap = (bounds.x as number) - LAPTOP.x
    const rightGap = LAPTOP.x + LAPTOP.width - ((bounds.x as number) + bounds.width)
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1)
  })

  it('never opens smaller than the editor can be used at', () => {
    const bounds = firstRunBounds({ x: 0, y: 0, width: 800, height: 600 })

    expect(bounds.width).toBeGreaterThanOrEqual(Math.min(MIN_WIDTH, 800))
    expect(bounds.height).toBeGreaterThanOrEqual(Math.min(MIN_HEIGHT, 600))
  })

  it('brings a window saved on a bigger screen back onto this one', () => {
    // Saved on a 4K display, reopened on the laptop: it would otherwise be off the edge.
    const confined = confineToWorkArea({ x: 3000, y: 1800, width: 2400, height: 1400 }, LAPTOP)

    expect(confined.width).toBeLessThanOrEqual(LAPTOP.width)
    expect(confined.height).toBeLessThanOrEqual(LAPTOP.height)
    expect(confined.x as number).toBeGreaterThanOrEqual(LAPTOP.x)
    expect((confined.x as number) + confined.width).toBeLessThanOrEqual(LAPTOP.x + LAPTOP.width)
    expect((confined.y as number) + confined.height).toBeLessThanOrEqual(LAPTOP.y + LAPTOP.height)
  })

  it('pulls back a window saved off the left of the screen', () => {
    const confined = confineToWorkArea({ x: -900, y: -400, width: 1200, height: 800 }, LAPTOP)

    expect(confined.x as number).toBeGreaterThanOrEqual(LAPTOP.x)
    expect(confined.y as number).toBeGreaterThanOrEqual(LAPTOP.y)
  })

  it('leaves a window that already fits exactly where it was', () => {
    const saved = { x: 100, y: 100, width: 1200, height: 800 }

    expect(confineToWorkArea(saved, LAPTOP)).toEqual(saved)
  })

  it('gives up remembered size rather than a window too big for a small screen', () => {
    const confined = confineToWorkArea({ x: 0, y: 25, width: 1500, height: 940 }, SMALL)

    expect(confined.width).toBe(SMALL.width)
    expect(confined.height).toBe(SMALL.height)
  })

  it('remembers where it was put', () => {
    saveWindowState({ x: 40, y: 60, width: 1300, height: 820 }, baseDir)

    expect(readWindowState(baseDir)).toEqual({ x: 40, y: 60, width: 1300, height: 820 })
  })

  it('reopens where it was last left', () => {
    saveWindowState({ x: 40, y: 60, width: 1300, height: 820 }, baseDir)

    expect(openingBounds(LAPTOP, baseDir)).toEqual({ x: 40, y: 60, width: 1300, height: 820 })
  })

  it('falls back to the screen when nothing has been remembered', () => {
    expect(openingBounds(LAPTOP, baseDir)).toEqual(firstRunBounds(LAPTOP))
  })

  it('ignores a remembered size that is nonsense rather than failing to open', () => {
    mkdirSync(join(baseDir, 'Talkie'), { recursive: true })
    writeFileSync(windowStatePath(baseDir), '{ "width": 12, "height": 8 }')

    // A window that will not open is worse than one that opens in the wrong place.
    expect(readWindowState(baseDir)).toBeNull()
    expect(openingBounds(LAPTOP, baseDir)).toEqual(firstRunBounds(LAPTOP))
  })

  it('ignores a file that is not json at all', () => {
    mkdirSync(join(baseDir, 'Talkie'), { recursive: true })
    writeFileSync(windowStatePath(baseDir), 'not json')

    expect(readWindowState(baseDir)).toBeNull()
  })

  it('keeps the window state beside the projects, not inside one', () => {
    expect(windowStatePath(baseDir)).toBe(join(baseDir, 'Talkie', 'window.json'))
  })
})
