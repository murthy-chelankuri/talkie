import { describe, expect, it } from 'vitest'
import { lengthInDescription, parseLength } from './sceneLength'

describe('how long a described scene runs', () => {
  it('reads a length however it is typed', () => {
    expect(parseLength('10s')).toBe(10)
    expect(parseLength('2 min')).toBe(120)
    expect(parseLength('2.5 minutes')).toBe(150)
    expect(parseLength('1:30')).toBe(90)
    expect(parseLength('45')).toBe(45)
    expect(parseLength('soon')).toBeNull()
    expect(parseLength('0')).toBeNull()
    expect(parseLength('90 min')).toBeNull()
  })

  it('finds a length said in the description when the box is left empty', () => {
    expect(lengthInDescription('generate a complex 5 min animation about tesla fsd')).toBe(300)
    expect(lengthInDescription('A 30-second chart of revenue')).toBe(30)
    expect(lengthInDescription('An animated bar chart of Q3 revenue')).toBeNull()
  })
})
