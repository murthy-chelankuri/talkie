import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { WebContents } from 'electron'

const openExternal = vi.fn()
vi.mock('electron', () => ({ shell: { openExternal: (url: string) => openExternal(url) } }))

const { applyNavigationGuards } = await import('./navigationGuards')

/** A stand-in for a window's web contents that records what was attached to it. */
function fakeContents() {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  let openHandler: ((details: { url: string }) => { action: string }) | null = null

  const contents = {
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, handler)
      return contents
    },
    setWindowOpenHandler(handler: (details: { url: string }) => { action: string }) {
      openHandler = handler
    }
  }

  return {
    contents: contents as unknown as WebContents,
    navigateTo(url: string) {
      const event = { preventDefault: vi.fn() }
      handlers.get('will-navigate')?.(event, url)
      return event.preventDefault.mock.calls.length > 0 ? 'blocked' : 'allowed'
    },
    open(url: string) {
      return openHandler?.({ url })
    },
    attachWebview() {
      const event = { preventDefault: vi.fn() }
      handlers.get('will-attach-webview')?.(event)
      return event.preventDefault.mock.calls.length > 0 ? 'blocked' : 'allowed'
    }
  }
}

describe('where a window may navigate', () => {
  beforeEach(() => openExternal.mockClear())

  it('lets the app’s own pages load', () => {
    const win = fakeContents()
    applyNavigationGuards(win.contents)

    expect(win.navigateTo('file:///Applications/Talkie.app/out/renderer/index.html')).toBe('allowed')
    expect(win.navigateTo('http://localhost:5173/toolbar.html')).toBe('allowed')
  })

  it('refuses to take a window to a remote page, where it would keep the bridge', () => {
    const win = fakeContents()
    applyNavigationGuards(win.contents)

    expect(win.navigateTo('https://evil.example.com')).toBe('blocked')
  })

  it('sends a real link to the browser instead, where it has no privileges', () => {
    const win = fakeContents()
    applyNavigationGuards(win.contents)
    win.navigateTo('https://remotion.dev/license')

    expect(openExternal).toHaveBeenCalledWith('https://remotion.dev/license')
  })

  it('hands nothing dangerous to the operating system', () => {
    const win = fakeContents()
    applyNavigationGuards(win.contents)

    win.navigateTo('file:///etc/passwd')        // an own-page scheme: allowed, not handed out
    win.navigateTo('javascript:alert(1)')
    win.navigateTo('data:text/html,<script>alert(1)</script>')

    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens no second window, whoever asks', () => {
    const win = fakeContents()
    applyNavigationGuards(win.contents)

    expect(win.open('https://example.com')?.action).toBe('deny')
    expect(win.open('javascript:alert(1)')?.action).toBe('deny')
    // A link a person clicked still reaches them, just not as a window of this app.
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    expect(openExternal).not.toHaveBeenCalledWith('javascript:alert(1)')
  })

  it('refuses to attach a webview', () => {
    const win = fakeContents()
    applyNavigationGuards(win.contents)

    expect(win.attachWebview()).toBe('blocked')
  })
})
