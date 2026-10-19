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

// The light values are Tailwind's theme (`@theme static`); the dark ones override them on the root.
describe.each([['@theme static', 'light'], [":root[data-theme='dark']", 'dark']])('the %s (%s) theme', (selector) => {
  const t = block(selector)
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
  it('sets the script’s notes, timings and warnings readable on paper', () => {
    expect(ratio(t['color-text-muted'], t['color-paper'])).toBeGreaterThanOrEqual(4.5)
    expect(ratio(t['color-warning'], t['color-paper'])).toBeGreaterThanOrEqual(4.5)
    // The timing chips are accent text at the size of the words around them.
    expect(ratio(t['color-accent'], t['color-paper'])).toBeGreaterThanOrEqual(5.8)
  })
})

it.each([['@theme static'], [":root[data-theme='dark']"]])('sets text on the filled accent readable in %s', (selector) => {
  const t = block(selector)
  expect(ratio(t['color-on-accent'], t['color-accent-fill'])).toBeGreaterThanOrEqual(4.5)
})
