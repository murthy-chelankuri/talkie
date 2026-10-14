import type { RenderTheme } from './renderTheme'

/**
 * Whether a logo can be seen on a background, and what to put behind it when it cannot.
 *
 * A logo is made for the brand's own pages, and a theme's backgrounds are often the brand's own
 * colours — a green opening card swallows the green part of a green-and-black logo, and its black letters
 * all but vanished on the dark slides. Where too much of the logo would be lost, it sits on a
 * small plate instead; elsewhere it is left exactly as the brand drew it.
 */

/** The colours a logo is made of, by how much of it each covers. Transparent pixels are not counted. */
export type LogoColours = Array<{ r: number; g: number; b: number; weight: number }>

/** Below this a part of a logo reads as a smudge. Lower than text's 3:1: a logo is a shape, and is large. */
const VISIBLE = 2

/** More than this much of a logo lost and it no longer reads as the logo. */
const TOO_MUCH_LOST = 0.2

function luminance(r: number, g: number, b: number): number {
  const linear = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** How much of the logo — by area — would be too close to the background to make out. */
export function lostShare(colours: LogoColours, background: string): number {
  const rgb = hexToRgb(background)
  const total = colours.reduce((sum, c) => sum + c.weight, 0)
  if (!rgb || total === 0) return 0
  const ground = luminance(...rgb)
  const lost = colours
    .filter(({ r, g, b }) => {
      const own = luminance(r, g, b)
      return (Math.max(own, ground) + 0.05) / (Math.min(own, ground) + 0.05) < VISIBLE
    })
    .reduce((sum, c) => sum + c.weight, 0)
  return lost / total
}

/**
 * The plate to put the logo on against this background, or null when it reads as it is.
 *
 * The theme's own light and dark grounds first, so a plate looks like part of the theme rather
 * than a sticker; plain white and black only if neither of those works either.
 */
export function logoPlate(colours: LogoColours | null, background: string | undefined, theme: RenderTheme): string | null {
  if (!colours || !background || lostShare(colours, background) <= TOO_MUCH_LOST) return null
  const candidates = [theme.variants.light.background, theme.variants.dark.background, '#ffffff', '#000000']
  return candidates.reduce((best, candidate) => (lostShare(colours, candidate) < lostShare(colours, best) ? candidate : best))
}

/**
 * Count the colours of an image's opaque pixels, close shades together. Takes raw RGBA so it can
 * be tested without a canvas; `readLogoColours` feeds it one.
 */
export function countColours(rgba: ArrayLike<number>): LogoColours {
  const counts = new Map<number, { r: number; g: number; b: number; weight: number }>()
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue
    // Sixteen steps a channel: enough to tell black from charcoal, few enough that the
    // anti-aliased edge of one shape does not count as a colour of its own.
    const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4)
    const seen = counts.get(key)
    if (seen) seen.weight++
    else counts.set(key, { r: rgba[i], g: rgba[i + 1], b: rgba[i + 2], weight: 1 })
  }
  return [...counts.values()].sort((a, b) => b.weight - a.weight).slice(0, 16)
}

const read = new Map<string, Promise<LogoColours | null>>()

/**
 * A logo's colours, read off the image as the browser draws it — the only reader that sees an SVG
 * the way the video will. Once per logo; null if it cannot be read, which leaves it unplated.
 */
export function readLogoColours(url: string): Promise<LogoColours | null> {
  let pending = read.get(url)
  if (!pending) {
    pending = new Promise((resolve) => {
      const image = new Image()
      const give = (colours: LogoColours | null): void => resolve(colours)
      image.onload = () => {
        try {
          const ratio = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 2
          const width = 160
          const height = Math.max(1, Math.round(width / ratio))
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const context = canvas.getContext('2d')
          if (!context) return give(null)
          context.drawImage(image, 0, 0, width, height)
          give(countColours(context.getImageData(0, 0, width, height).data))
        } catch {
          give(null)
        }
      }
      image.onerror = () => give(null)
      image.src = url
    })
    read.set(url, pending)
  }
  return pending
}
