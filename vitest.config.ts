import { tmpdir } from 'os'
import { join } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // Recording tests drive a real Chromium. Headed, every run throws windows in front of
    // whatever else is on screen and takes the keyboard with them; nothing in the suite looks
    // at the window, so there is no reason to show it. See HEADLESS in recordSession.ts.
    //
    // Overridable because a recording test that misbehaves is far easier to understand when you
    // can watch it: `TALKIE_HEADLESS=0 npm test`.
    //
    // The log goes to a folder of the run's own, so a test that fails on purpose never writes into
    // the person's ~/Talkie/logs — the file a problem report is made from.
    env: { TALKIE_HEADLESS: process.env.TALKIE_HEADLESS ?? '1', TALKIE_LOG_HOME: join(tmpdir(), 'talkie-test-logs') },
    include: [
      'src/main/**/*.test.ts',
      'src/mcp/**/*.test.ts',
      'src/composition/**/*.test.{ts,tsx}',
      'src/video/**/*.test.{ts,tsx}',
      'src/renderer/**/*.test.{ts,tsx}',
      'src/htmlScene/**/*.test.ts'
    ],
    environmentMatchGlobs: [['src/renderer/**/*.test.{ts,tsx}', 'jsdom']],
    setupFiles: ['src/renderer/src/test/setup.ts']
  }
})
