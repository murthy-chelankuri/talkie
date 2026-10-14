import { defineConfig } from 'vite'
import { builtinModules } from 'module'
import { resolve } from 'path'

/**
 * The MCP server is a plain Node program, not part of the Electron app, so it is built on its
 * own rather than by electron-vite: no asar, no CommonJS workaround, and none of the Electron
 * runtime. It shares the app's `src/main` modules by importing them directly, which is what
 * keeps an agent-made project identical to one made in the window.
 *
 * Dependencies stay external — Playwright in particular resolves browsers relative to its own
 * installed location and cannot be bundled.
 */
export default defineConfig({
  build: {
    target: 'node20',
    outDir: 'out/mcp',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/mcp/main.ts'),
      formats: ['es'],
      fileName: () => 'talkie-mcp.mjs'
    },
    rollupOptions: {
      external: (id) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
      output: {
        // The shared modules find what ships beside them from __dirname — the HTML scene
        // runtime among them — and an ES module has no __dirname. Defined here from the file's own
        // URL, so those lookups land in out/ as they do in the app, not in a ReferenceError.
        banner: [
          '#!/usr/bin/env node',
          "import { fileURLToPath as __talkieFileUrlToPath } from 'node:url'",
          "import { dirname as __talkieDirname } from 'node:path'",
          'const __filename = __talkieFileUrlToPath(import.meta.url)',
          'const __dirname = __talkieDirname(__filename)'
        ].join('\n')
      }
    }
  },
  resolve: {
    conditions: ['node'],
    mainFields: ['module', 'main']
  },
  ssr: { target: 'node', external: builtinModules }
})
