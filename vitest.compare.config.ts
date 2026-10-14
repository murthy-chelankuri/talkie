import { defineConfig } from 'vitest/config'

/**
 * Talkie's own export against Remotion's, on the shipped examples (spec §3, "Proof"). Minutes,
 * not seconds — opt-in, run by `npm run compare:renderer`, and part of the gates while both
 * exporters exist.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/render/exporter/compare/**/*.compare.ts'],
    testTimeout: 20 * 60_000,
    hookTimeout: 20 * 60_000,
    fileParallelism: false
  }
})
