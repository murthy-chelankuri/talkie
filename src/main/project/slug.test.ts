import { describe, expect, it } from 'vitest'
import { slugify } from './slug'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Checkout Flow Demo')).toBe('checkout-flow-demo')
  })

  it('strips non-alphanumeric characters', () => {
    expect(slugify('Q3 Launch! (v2)')).toBe('q3-launch-v2')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --Weird Name--  ')).toBe('weird-name')
  })

  it('falls back to "untitled" for an empty result', () => {
    expect(slugify('***')).toBe('untitled')
  })
})
