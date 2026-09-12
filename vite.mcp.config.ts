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
        banner: '#!/usr/bin/env node'
      }
    }
  },
  resolve: {
    conditions: ['node'],
    mainFields: ['module', 'main']
  },
  ssr: { target: 'node', external: builtinModules }
})
