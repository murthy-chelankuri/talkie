import { defineConfig } from 'vitest/config'

/**
 * Builds the example projects Talkie ships with. Kept out of `npm test`: it voices a few minutes
 * of narration and is run when a story changes, not on every commit.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['examples/build/**/*.build.ts'],
    fileParallelism: false,
    testTimeout: 900_000,
    // The walkthrough is recorded headed, as the app always records. Headless Chromium draws the
    // page at 1.5x into only the top 720 rows of the 1080 frame and pads the rest grey, which the
    // suite never looks at and an example would ship.
    env: { TALKIE_HEADLESS: '0' }
  }
})
