import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// This package is ESM ("type": "module"), which would make the main and preload bundles ESM
// too — and Electron cannot load an ES module from inside an asar archive, so a packaged build
// starts, reports itself ready, and never opens a window. Emitting CommonJS with an explicit
// .cjs extension keeps them loadable while the rest of the project stays ESM.
const commonJsOutput = {
  build: {
    rollupOptions: {
      output: { format: 'cjs' as const, entryFileNames: '[name].cjs' }
    }
  }
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], ...commonJsOutput },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // The recording toolbar is its own window with its own, much smaller, bridge.
        input: {
          index: resolve('src/preload/index.ts'),
          toolbar: resolve('src/preload/toolbar.ts')
        },
        output: commonJsOutput.build.rollupOptions.output
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          toolbar: resolve('src/renderer/toolbar.html')
        }
      }
    }
  }
})
