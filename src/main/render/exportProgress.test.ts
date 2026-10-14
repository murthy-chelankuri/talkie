import { describe, expect, it } from 'vitest'
import { drawing, encoding, finishing, preparing } from './exportProgress'

describe('how far an export has got', () => {
  it('starts at nothing, getting ready', () => {
    expect(preparing(300)).toEqual({ stage: 'preparing', fraction: 0, renderedFrames: 0, totalFrames: 300 })
  })

  it('moves through the middle of the bar as frames are drawn', () => {
    const half = drawing(150, 300)
    expect(half.stage).toBe('rendering')
    expect(half.fraction).toBeGreaterThan(0.4)
    expect(half.fraction).toBeLessThan(0.6)
  })

  it('moves through drawing as frames are captured, and holds a share back for encoding', () => {
    expect(drawing(0, 100).stage).toBe('rendering')
    expect(drawing(50, 100).fraction).toBeGreaterThan(drawing(10, 100).fraction)
    expect(drawing(100, 100).fraction).toBeLessThan(encoding(100).fraction)
    expect(encoding(100).stage).toBe('encoding')
    expect(encoding(100).fraction).toBeLessThan(finishing(100).fraction)
  })

  it('never runs past the end, however many frames it is told about', () => {
    expect(drawing(500, 300).fraction).toBeLessThanOrEqual(finishing(300).fraction)
    expect(drawing(500, 300).renderedFrames).toBe(300)
    expect(Number.isFinite(drawing(0, 0).fraction)).toBe(true)
  })
})
