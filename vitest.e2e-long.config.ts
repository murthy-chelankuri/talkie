import { defineConfig } from 'vitest/config'

/**
 * The long end-to-end run (`npm run e2e:long`): what takes minutes rather than seconds — long
 * narration voiced in Kokoro, every example exported whole, and a clean clone set up from nothing.
 * Not in the push hook, which would make every push wait a quarter of an hour; run it before a
 * release, and after changing anything in speech, export or setup. Same rules as the quick run:
 * the built app, a throwaway home, one at a time.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/long/**/*.e2e.ts'],
    fileParallelism: false,
    testTimeout: 45 * 60_000,
    hookTimeout: 120_000
  }
})
