import { chromium } from 'playwright'
import { resolveBrowser } from '../../capture/resolveBrowser'
import type { BrandFacts } from './facts'

const MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

/**
 * Run in the page: the picture's pixels, counted by colour after rounding each channel to the
 * nearest 16, so the antialiased edge of a shape does not become a colour of its own. Clear and
 * near-white pixels are the ground the logo sits on, not part of it.
 */
async function countColours(src: string): Promise<{ hex: string; count: number }[]> {
  const img = new Image()
  img.src = src
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  ctx.drawImage(img, 0, 0, 96, 96)
  const { data } = ctx.getImageData(0, 0, 96, 96)

  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    if (r > 240 && g > 240 && b > 240) continue
    const key = [r, g, b].map((c) => c >> 4).join(',')
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 }
    bucket.r += r
    bucket.g += g
    bucket.b += b
    bucket.count += 1
    buckets.set(key, bucket)
  }

  const hex = (n: number): string => Math.round(n).toString(16).padStart(2, '0')
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(({ r, g, b, count }) => ({ hex: `#${hex(r / count)}${hex(g / count)}${hex(b / count)}`, count }))
}

/**
 * The colours a logo is made of, in order of how much of it each covers.
 *
 * Drawn on a canvas in the headless browser Talkie already has: Chromium decodes every format a
 * logo comes in, SVG included, which no small Node library does.
 */
export async function readLogo(bytes: Buffer, fileName: string): Promise<BrandFacts> {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  const type = MIME[extension]
  if (!type) throw new Error('A logo has to be an SVG, PNG, JPEG or WebP image.')

  const browser = await chromium.launch({ headless: true, channel: resolveBrowser()?.channel })
  try {
    const page = await browser.newPage()
    const counted = await page.evaluate(countColours, `data:${type};base64,${bytes.toString('base64')}`)
    return {
      colours: counted.map(({ hex, count }) => ({ hex, weight: count, role: 'logo' as const })),
      fonts: [],
      logo: { bytes, fileName: `logo.${extension === 'jpeg' ? 'jpg' : extension}` },
      sources: ['logo'],
      problems: []
    }
  } finally {
    await browser.close()
  }
}
