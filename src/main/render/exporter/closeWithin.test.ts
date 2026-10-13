import { describe, expect, it, vi } from 'vitest'
import { closeBrowserServer, closeWithin } from './closeWithin'

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

describe('closing the browser server', () => {
  it('closes the server even when connecting to it never produced a browser', async () => {
    const server = { close: vi.fn(async () => undefined), kill: vi.fn() }

    await closeBrowserServer(null, server)

    expect(server.close).toHaveBeenCalledOnce()
  })

  it('closes the server when the browser will not close cleanly', async () => {
    const server = { close: vi.fn(async () => undefined), kill: vi.fn() }

    await closeBrowserServer({ close: () => Promise.reject(new Error('gone')) }, server)

    expect(server.close).toHaveBeenCalledOnce()
  })
})
