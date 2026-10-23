import { afterEach, describe, expect, it, vi } from 'vitest'
import { themeClient } from './projectClient'
import { onSettingsChanged } from '../lib/settingsChanged'

afterEach(() => vi.unstubAllGlobals())

function stubThemesApi(): void {
  vi.stubGlobal('api', {
    themes: {
      update: vi.fn().mockResolvedValue({ id: 't1' }),
      create: vi.fn().mockResolvedValue({ id: 't2' }),
      remove: vi.fn().mockResolvedValue(undefined),
      addAsset: vi.fn().mockResolvedValue('logo.svg'),
      list: vi.fn().mockResolvedValue([])
    }
  })
}

describe('changing a theme while a project is open', () => {
  it('tells the open project, so its preview and thumbnails pick up the new look', async () => {
    stubThemesApi()
    const heard = vi.fn()
    const stop = onSettingsChanged(heard)

    await themeClient.update('t1', {} as never)
    await themeClient.addAsset({ themeId: 't1' }, 'logo', 'light', 'logo.svg', new Uint8Array())
    await themeClient.remove('t1')
    stop()

    expect(heard).toHaveBeenCalledTimes(3)
  })

  it('says nothing for a change that did not happen', async () => {
    stubThemesApi()
    vi.mocked(window.api.themes.update).mockRejectedValue(new Error('No theme found'))
    const heard = vi.fn()
    const stop = onSettingsChanged(heard)

    await expect(themeClient.update('t1', {} as never)).rejects.toThrow()
    stop()

    expect(heard).not.toHaveBeenCalled()
  })

  it('says nothing for merely looking', async () => {
    stubThemesApi()
    const heard = vi.fn()
    const stop = onSettingsChanged(heard)

    await themeClient.list()
    stop()

    expect(heard).not.toHaveBeenCalled()
  })
})
