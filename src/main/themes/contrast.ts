import type { ThemeDraft, VariantId } from './schema'
import { VARIANT_IDS } from './schema'

/**
 * Whether a theme can be read, and the smallest change that makes it so.
 *
 * Brand palettes are chosen for logos and buttons, not for a paragraph on a slide, and a pale
 * brand grey as body text on white is the commonest way a generated theme fails. Fixed by moving
 * only the colour's lightness, in OKLCH, so a blue stays the same blue — just darker — rather
 * than drifting towards a different hue, which is what adjusting RGB channels does.
 */

/** WCAG 2.x: body text, large headings, and a mark that is not text. */
const MINIMUM = { heading: 3, body: 4.5, accent: 3 } as const

type Rgb = [number, number, number]

function toRgb(hex: string): Rgb {
  const value = hex.replace('#', '')
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16) / 255) as Rgb
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, '0'))
    .join('')}`
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** sRGB → OKLab → OKLCH, after Björn Ottosson. */
function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), Math.atan2(B, A)]
}

function fromOklch([L, C, h]: [number, number, number]): string {
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return toHex([
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  ])
}

/**
 * The nearest colour to `colour`, in lightness only, that reaches `minimum` against `background`.
 * Darker on a light background, lighter on a dark one; black or white if nothing in between does.
 */
function readableAgainst(colour: string, background: string, minimum: number): string {
  if (contrastRatio(colour, background) >= minimum) return colour

  const towardsDark = luminance(background) > 0.18
  const [L, C, h] = toOklch(colour)
  for (let step = 1; step <= 50; step++) {
    const next = fromOklch([Math.min(1, Math.max(0, towardsDark ? L - step * 0.02 : L + step * 0.02)), C, h])
    if (contrastRatio(next, background) >= minimum) return next
  }
  return towardsDark ? '#000000' : '#ffffff'
}

export function fixContrast(draft: ThemeDraft): { draft: ThemeDraft; notes: string[] } {
  const notes: string[] = []
  const variants = { ...draft.variants }

  for (const id of VARIANT_IDS as readonly VariantId[]) {
    const variant = { ...variants[id] }
    for (const role of ['heading', 'body', 'accent'] as const) {
      const before = variant[role]
      const after = readableAgainst(before, variant.background, MINIMUM[role])
      if (after !== before) {
        variant[role] = after
        notes.push(
          `${id} ${role}: ${before} was hard to read on ${variant.background}, so it was changed to ${after}.`
        )
      }
    }
    variants[id] = variant
  }

  return notes.length === 0 ? { draft, notes } : { draft: { ...draft, variants }, notes }
}

/** How far a colour is from grey, 0 to 1 — HSL saturation, enough to tell a brand colour from a neutral. */
export function saturation(hex: string): number {
  const [r, g, b] = toRgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const lightness = (max + min) / 2
  return (max - min) / (1 - Math.abs(2 * lightness - 1))
}

/** `a` moved `amount` of the way towards `b`. */
export function mix(a: string, b: string, amount: number): string {
  const [x, y] = [toRgb(a), toRgb(b)]
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * amount) as Rgb)
}
