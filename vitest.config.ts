import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts', 'src/remotion/**/*.test.ts', 'src/renderer/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['src/renderer/**/*.test.{ts,tsx}', 'jsdom']],
    setupFiles: ['src/renderer/src/test/setup.ts']
  }
})
