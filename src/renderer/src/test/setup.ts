import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

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
