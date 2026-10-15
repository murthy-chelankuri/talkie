import { beforeEach, describe, expect, it } from 'vitest'
import { hold } from './hold'
import { openHoldCount, resetHolds, whenSettled } from './own/hold'

beforeEach(() => resetHolds())

/** Long after anything was opened, so every hold has outlived its timeout. */
const later = (): number => Date.now() + 120_000

describe('a hold', () => {
  it('keeps the frame from being taken, under the label an export failure would name', async () => {
    hold(`Loading the theme's fonts`)

    expect(openHoldCount()).toBe(1)
    await expect(whenSettled({ now: later })).rejects.toThrow(`Loading the theme's fonts`)
  })

  it('passes on how long it may be held', async () => {
    hold('Fetching diagram', { timeoutMs: 30_000 })

    await expect(whenSettled({ now: later })).rejects.toThrow('Fetching diagram did not finish within 30 s')
  })

  it('lets the frame go once, however many times it is released', () => {
    // LogoMark releases when the colours arrive and again when it unmounts.
    const release = hold(`Reading the logo's colours`)
    hold('Someone else’s')
    release()
    release()

    expect(openHoldCount()).toBe(1)
  })
})
