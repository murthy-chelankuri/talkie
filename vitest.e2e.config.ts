import { defineConfig } from 'vitest/config'

/**
 * The end-to-end run: the built app, driven through its own window.
 *
 * Kept apart from `vitest.config.ts` because it tests `out/`, not the sources — it needs a fresh
 * `npm run build` first, which `npm run e2e` does — and because one app at a time is the only
 * way the timings mean anything.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000
  }
})
