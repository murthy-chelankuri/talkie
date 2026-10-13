import { existsSync } from 'fs'
import { join } from 'path'

/**
 * Where Remotion's own compositor binaries are, for Remotion's export (renderMedia and
 * selectComposition in renderProject.ts) and nothing else; everything Talkie runs itself goes
 * through src/main/media. Goes with step 3 of the renderer, when Talkie's own export replaces it.
 *
 * Remotion resolves them relative to its own package, which works while the app runs from a
 * checkout. In a packaged build the code lives inside an asar archive, and a native binary
 * cannot be executed from there — electron-builder copies it out to `app.asar.unpacked`, and
 * nothing rewrites Remotion's idea of where it went.
 */
export function binariesDirectory(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (!resourcesPath) return null

  const unpacked = join(resourcesPath, 'app.asar.unpacked', 'node_modules', '@remotion')
  if (!existsSync(unpacked)) return null

  // The compositor package is named for the platform it was built for.
  const compositor = compositorDirectory(unpacked)
  return compositor && existsSync(join(compositor, 'ffmpeg')) ? compositor : null
}

function compositorDirectory(remotionDir: string): string | null {
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'

  const candidate = join(remotionDir, `compositor-${platform}-${arch}`)
  return existsSync(candidate) ? candidate : null
}
