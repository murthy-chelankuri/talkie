import { describe, expect, it } from 'vitest'
import { countColours, logoPlate, lostShare, type LogoColours } from './logoLegibility'
import type { RenderTheme } from './renderTheme'

/** A two-colour logo: black letters, and a green piece about a quarter of it. */
const BLACK_AND_GREEN: LogoColours = [
  { r: 0, g: 0, b: 0, weight: 75 },
  { r: 3, g: 168, b: 131, weight: 25 }
]

const theme: RenderTheme = {
  stamp: 's',
  company: 'Acme',
  tagline: '',
  website: '',
  variants: {
    brand: { background: '#01a982', heading: '#000000', body: '#1d1f27', accent: '#292d3a' },
    light: { background: '#ffffff', heading: '#292d3a', body: '#333333', accent: '#01a982' },
    dark: { background: '#292d3a', heading: '#ffffff', body: '#e6e8e9', accent: '#05cc93' }
  },
  fonts: { heading: { family: 'Inter', urls: [] }, body: { family: 'Inter', urls: [] } },
  caption: 'dark'
}

describe('whether a logo can be seen on a background', () => {
  it('loses the part of the logo that is the background’s own colour', () => {
    expect(lostShare(BLACK_AND_GREEN, '#01a982')).toBeCloseTo(0.25)
  })

  it('loses dark letters on a dark ground', () => {
    expect(lostShare(BLACK_AND_GREEN, '#292d3a')).toBeCloseTo(0.75)
  })

  it('loses nothing on the ground it was made for', () => {
    expect(lostShare(BLACK_AND_GREEN, '#ffffff')).toBe(0)
  })
})

describe('putting a logo on a plate', () => {
  it('plates it where too much would be lost, on the theme’s own light ground', () => {
    expect(logoPlate(BLACK_AND_GREEN, '#01a982', theme)).toBe('#ffffff')
    expect(logoPlate(BLACK_AND_GREEN, '#292d3a', theme)).toBe('#ffffff')
  })

  it('leaves it bare where it reads', () => {
    expect(logoPlate(BLACK_AND_GREEN, '#ffffff', theme)).toBeNull()
  })

  it('takes the theme’s dark ground for a light logo', () => {
    const white: LogoColours = [{ r: 255, g: 255, b: 255, weight: 1 }]

    expect(logoPlate(white, '#ffffff', theme)).toBe('#292d3a')
  })

  it('leaves it alone when its colours could not be read, or the ground is not known', () => {
    expect(logoPlate(null, '#292d3a', theme)).toBeNull()
    expect(logoPlate(BLACK_AND_GREEN, undefined, theme)).toBeNull()
  })
})

describe('reading a logo’s colours', () => {
  it('counts the opaque pixels only, close shades together', () => {
    const pixels = [
      [0, 0, 0, 255], [2, 1, 3, 255], [3, 168, 131, 255], [255, 0, 0, 0]
    ].flat()

    expect(countColours(pixels).map(({ weight }) => weight)).toEqual([2, 1])
  })
})
