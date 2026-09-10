import { describe, expect, it } from 'vitest'
import { hasVisibleContent } from './frameContent'

function solid(r: number, g: number, b: number, pixelCount = 64): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(pixelCount * 4)
  for (let i = 0; i < pixelCount; i++) {
    pixels.set([r, g, b, 255], i * 4)
  }
  return pixels
}

describe('hasVisibleContent', () => {
  it('rejects a flat white frame, as recorded before a page paints', () => {
    expect(hasVisibleContent(solid(255, 255, 255))).toBe(false)
  })

  it('rejects a flat black frame', () => {
    expect(hasVisibleContent(solid(0, 0, 0))).toBe(false)
  })

  it('accepts a frame with dark text on a white background', () => {
    const pixels = solid(255, 255, 255)
    // A tenth of the pixels turned to near-black, as a line of text would.
    for (let i = 0; i < 6; i++) {
      pixels.set([10, 10, 10, 255], i * 4)
    }
    expect(hasVisibleContent(pixels)).toBe(true)
  })

  it('rejects an empty pixel buffer', () => {
    expect(hasVisibleContent(new Uint8ClampedArray(0))).toBe(false)
  })
})
