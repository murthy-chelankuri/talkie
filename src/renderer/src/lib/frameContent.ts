// A browser recording starts on a blank page and only paints once the site has loaded, so the
// first frames of a capture are a flat white rectangle. Picking a thumbnail means finding the
// first frame that isn't flat, which this measures as the spread of pixel luminance.
const FLAT_LUMINANCE_STDDEV = 6

export function hasVisibleContent(pixels: Uint8ClampedArray): boolean {
  const pixelCount = Math.floor(pixels.length / 4)
  if (pixelCount === 0) return false

  let total = 0
  const luminances = new Float64Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4
    const luminance = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2]
    luminances[i] = luminance
    total += luminance
  }

  const mean = total / pixelCount
  let variance = 0
  for (let i = 0; i < pixelCount; i++) {
    variance += (luminances[i] - mean) ** 2
  }

  return Math.sqrt(variance / pixelCount) > FLAT_LUMINANCE_STDDEV
}
