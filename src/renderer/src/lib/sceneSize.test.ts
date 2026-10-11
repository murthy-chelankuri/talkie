import { describe, expect, it } from 'vitest'
import { BASE_TEXT_PX, BASE_WIDTH, resized, textPxFor } from './sceneSize'

describe('dragging a scene larger', () => {
  it('keeps the corner under the pointer, since the scene is centred', () => {
    expect(resized({ width: BASE_WIDTH, height: 0 }, 100, 0, 2000).width).toBe(BASE_WIDTH + 200)
  })

  it('adds room below the words as the corner is dragged down', () => {
    expect(resized({ width: BASE_WIDTH, height: 0 }, 0, 120, 2000).height).toBe(120)
  })

  it('never goes smaller than the usual column, nor wider than the page', () => {
    expect(resized({ width: BASE_WIDTH, height: 0 }, -300, -300, 2000)).toEqual({ width: BASE_WIDTH, height: 0 })
    expect(resized({ width: BASE_WIDTH, height: 0 }, 5000, 0, 1100).width).toBe(1100)
  })
})

describe('the words grow with the scene', () => {
  it('reads at the usual size in the usual column', () => {
    expect(textPxFor(BASE_WIDTH)).toBe(BASE_TEXT_PX)
  })

  it('reads larger as the scene is widened, up to a limit', () => {
    expect(textPxFor(BASE_WIDTH * 1.5)).toBe(Math.round(BASE_TEXT_PX * 1.5))
    expect(textPxFor(BASE_WIDTH * 10)).toBe(30)
  })
})
