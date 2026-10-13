import { describe, expect, it, vi } from 'vitest'
import { closeWithin } from './closeWithin'

describe('closing a browser within a limit', () => {
  it('kills it and carries on when the close never finishes', async () => {
    const forceKill = vi.fn()

    await closeWithin(() => new Promise(() => undefined), forceKill, 20)

    expect(forceKill).toHaveBeenCalledOnce()
  })

  it('leaves it alone when the close finishes in time', async () => {
    const forceKill = vi.fn()

    await closeWithin(async () => undefined, forceKill, 200)

    expect(forceKill).not.toHaveBeenCalled()
  })

  it('does not throw when the close fails', async () => {
    const forceKill = vi.fn()

    await expect(closeWithin(() => Promise.reject(new Error('gone')), forceKill, 200)).resolves.toBeUndefined()
    expect(forceKill).not.toHaveBeenCalled()
  })
})
