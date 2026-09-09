import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom does not implement window.matchMedia (it has no rendering engine to
// evaluate media queries against), so anything that calls it — e.g. the
// dark-mode-preference check in useTheme — throws unless a stub is present.
// Tests that care about a specific match result (see useTheme.test.tsx)
// override this per-test; everything else just needs it to exist.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  })
}

// Node 22+ defines its own experimental global `localStorage`/`sessionStorage`
// accessors that throw unless `--localstorage-file` is passed. Vitest's jsdom
// environment skips overriding globals that already exist on `globalThis`
// unless they're in its fixed key allowlist, and `localStorage`/`sessionStorage`
// aren't in that list — so Node's broken accessors win over jsdom's real
// implementation. Rebind them to jsdom's window explicitly.
const jsdomInstance = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom
if (jsdomInstance) {
  Object.defineProperty(globalThis, 'localStorage', {
    get: () => jsdomInstance.window.localStorage,
    configurable: true
  })
  Object.defineProperty(globalThis, 'sessionStorage', {
    get: () => jsdomInstance.window.sessionStorage,
    configurable: true
  })
}

afterEach(() => {
  cleanup()
})
