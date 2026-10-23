import { describe, expect, it } from 'vitest'
import { registerThemeHandlers } from './themeHandlers'

function handlersFrom(): Map<string, (...args: unknown[]) => unknown> {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) }
  registerThemeHandlers(ipcMain as never)
  return handlers
}

describe('theme IPC', () => {
  it('registers a compliance channel', () => {
    expect(handlersFrom().has('settings:themes:compliance')).toBe(true)
  })

  it('carries a slot through addAsset', () => {
    // _event, target, kind, slot, fileName, bytes
    expect(handlersFrom().get('settings:themes:addAsset')?.length).toBeGreaterThanOrEqual(6)
  })
})
