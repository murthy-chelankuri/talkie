import { afterEach, describe, expect, it } from 'vitest'
import { ownHold, reportFailure, resetHolds, whenSettled } from './hold'

afterEach(() => resetHolds())

describe('Talkie’s own holds', () => {
  it('settles at once when nothing is held', async () => {
    await expect(whenSettled()).resolves.toBeUndefined()
  })

  it('waits until every hold is released', async () => {
    const release = ownHold('Loading the theme’s fonts')
    let settled = false
    const waiting = whenSettled({ wait: () => new Promise((resolve) => setTimeout(resolve, 1)) }).then(() => (settled = true))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).toBe(false)
    release()
    await waiting
    expect(settled).toBe(true)
  })

  it('lets go once, however many times it is released', async () => {
    const release = ownHold('Reading the logo’s colours')
    release()
    release()
    await expect(whenSettled()).resolves.toBeUndefined()
  })

  it('fails naming the hold that outlived its timeout', async () => {
    let clock = 0
    ownHold('Fetching diagram flow.svg', 1000, () => clock)
    const wait = async (): Promise<void> => void (clock += 600)
    await expect(whenSettled({ now: () => clock, wait })).rejects.toThrow('Fetching diagram flow.svg did not finish within 1 s')
  })

  it('gives up after 30 s when no timeout was given', async () => {
    let clock = 0
    ownHold('Loading the HTML scene "Revenue"', undefined, () => clock)
    const wait = async (): Promise<void> => void (clock += 10_000)
    await expect(whenSettled({ now: () => clock, wait })).rejects.toThrow('within 30 s')
  })

  it('fails at once on a reported failure, so a broken picture does not wait out a timeout', async () => {
    ownHold('Loading clip.mp4')
    reportFailure('Could not load clip.mp4')
    await expect(whenSettled()).rejects.toThrow('Could not load clip.mp4')
  })
})
