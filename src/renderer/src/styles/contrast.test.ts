import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const css = readFileSync(join(__dirname, 'index.css'), 'utf-8')
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]))
}
const lum = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe.each([[':root', 'light'], ["[data-theme='dark']", 'dark']])('the %s (%s) theme', (selector) => {
  const t = block(selector.startsWith('[') ? `:root${selector}` : selector)
  const surfaces = ['color-bg', 'color-surface', 'color-raised', 'color-surface-hover']
  it('sets accent text clear of 5.8:1 on every surface', () => {
    for (const s of surfaces) expect(ratio(t['color-accent'], t[s]), s).toBeGreaterThanOrEqual(5.8)
  })
  it('sets body and muted text clear of 4.5:1 on every surface', () => {
    for (const s of surfaces) {
      expect(ratio(t['color-text'], t[s]), s).toBeGreaterThanOrEqual(4.5)
      expect(ratio(t['color-text-muted'], t[s]), s).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('sets the script readable on paper', () => {
    expect(ratio(t['color-paper-text'], t['color-paper'])).toBeGreaterThanOrEqual(4.5)
  })
})

it('sets text on the gradient readable at both of its ends', () => {
  const ink = block(':root')['color-on-gradient']
  for (const end of ['#7c6cff', '#4fc3ff']) expect(ratio(ink, end), end).toBeGreaterThanOrEqual(4.5)
})
