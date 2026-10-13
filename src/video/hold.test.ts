import { beforeEach, describe, expect, it, vi } from 'vitest'

const delayRender = vi.fn((_label?: string, _options?: object) => 7)
const continueRender = vi.fn((_handle: number) => undefined)
vi.mock('remotion', () => ({ delayRender, continueRender }))

const { hold } = await import('./hold')

beforeEach(() => {
  delayRender.mockClear()
  continueRender.mockClear()
})

describe('a hold', () => {
  it('keeps the frame from being taken, under the label an export failure would name', () => {
    hold(`Loading the theme's fonts`)

    expect(delayRender).toHaveBeenCalledWith(`Loading the theme's fonts`, undefined)
  })

  it('passes on how long it may be held', () => {
    hold('Fetching diagram', { timeoutMs: 30_000 })

    expect(delayRender).toHaveBeenCalledWith('Fetching diagram', { timeoutInMilliseconds: 30_000 })
  })

  it('lets the frame go once, however many times it is released', () => {
    // LogoMark releases when the colours arrive and again when it unmounts.
    const release = hold(`Reading the logo's colours`)
    release()
    release()

    expect(continueRender).toHaveBeenCalledTimes(1)
    expect(continueRender).toHaveBeenCalledWith(7)
  })
})
