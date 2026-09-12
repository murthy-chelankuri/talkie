import { chromium } from 'playwright'
import { readFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Rebuild the app icon from its two SVGs.
 *
 *   node build/build-icon.mjs
 *
 * Rendered in a real browser because that is the only thing here that draws SVG, and written into
 * every slot an icns carries — the two smallest from the simplified mark, since at that size the
 * held line and four bars collapse into a smudge.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const full = readFileSync(`${ROOT}/build/icon.svg`, 'utf8')
const small = readFileSync(`${ROOT}/build/icon-small.svg`, 'utf8')
const set = `${ROOT}/build/icon.iconset`
rmSync(set, { recursive: true, force: true })
mkdirSync(set, { recursive: true })

// Every slot an icns carries. The two smallest use the simplified mark.
const slots = [
  [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png']
]

const browser = await chromium.launch()
for (const [size, name] of slots) {
  const svg = size <= 32 ? small : full
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(`<body style="margin:0">${svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body>`)
  await page.screenshot({ path: `${set}/${name}`, omitBackground: true })
  await page.close()
}
await browser.close()

execFileSync('iconutil', ['-c', 'icns', set, '-o', `${ROOT}/build/icon.icns`])
rmSync(set, { recursive: true, force: true })
console.log('icns built')
