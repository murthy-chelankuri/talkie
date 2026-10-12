import { describe, expect, it } from 'vitest'
import { describeDuration, describeTimeLeft, secondsLeft } from './exportTime'

describe('how long an export has left', () => {
  it('says nothing until there is enough to go on', () => {
    expect(secondsLeft(10_000, 0.03)).toBeNull()
    expect(secondsLeft(1000, 0.5)).toBeNull()
  })

  it('extends the rate so far over what is left', () => {
    expect(secondsLeft(30_000, 0.25)).toBe(90)
  })

  it('rounds the way people say it', () => {
    expect(describeTimeLeft(null)).toBeNull()
    expect(describeTimeLeft(4)).toBe('Almost done')
    expect(describeTimeLeft(42)).toBe('About 50 sec left')
    expect(describeTimeLeft(150)).toBe('About 3 min left')
  })

  it('says how long a finished one took', () => {
    expect(describeDuration(45)).toBe('45 sec')
    expect(describeDuration(72)).toBe('1 min 12 sec')
    expect(describeDuration(120)).toBe('2 min')
  })
})
