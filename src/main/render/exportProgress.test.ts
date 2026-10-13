import { describe, expect, it } from 'vitest'
import { drawing, encoding, finishing, preparing, rendering } from './exportProgress'

describe('how far an export has got', () => {
  it('starts at nothing, getting ready', () => {
    expect(preparing(300)).toEqual({ stage: 'preparing', fraction: 0, renderedFrames: 0, totalFrames: 300 })
  })

  it('moves through the middle of the bar as frames are drawn', () => {
    const half = rendering({ progress: 0.5, renderedFrames: 150, stitchStage: 'encoding' }, 300)
    expect(half.stage).toBe('rendering')
    expect(half.fraction).toBeGreaterThan(0.4)
    expect(half.fraction).toBeLessThan(0.6)
  })

  it('says it is putting the file together once every frame is drawn', () => {
    expect(rendering({ progress: 0.9, renderedFrames: 300, stitchStage: 'encoding' }, 300).stage).toBe('encoding')
    expect(rendering({ progress: 0.98, renderedFrames: 300, stitchStage: 'muxing' }, 300).stage).toBe('encoding')
  })

  it('never runs backwards into finishing or past the end', () => {
    const done = rendering({ progress: 1, renderedFrames: 300, stitchStage: 'muxing' }, 300)
    expect(done.fraction).toBeLessThanOrEqual(finishing(300).fraction)
    expect(rendering({ progress: Number.NaN, renderedFrames: 0, stitchStage: 'encoding' }, 300).fraction).toBeGreaterThanOrEqual(0)
  })

  it('moves through drawing as frames are captured, and holds a share back for encoding', () => {
    expect(drawing(0, 100).stage).toBe('rendering')
    expect(drawing(50, 100).fraction).toBeGreaterThan(drawing(10, 100).fraction)
    expect(drawing(100, 100).fraction).toBeLessThan(encoding(100).fraction)
    expect(encoding(100).stage).toBe('encoding')
    expect(encoding(100).fraction).toBeLessThan(finishing(100).fraction)
  })
})
