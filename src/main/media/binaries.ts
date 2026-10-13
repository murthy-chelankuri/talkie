import { existsSync } from 'fs'
import { dirname, join } from 'path'

export type MediaTool = 'ffmpeg' | 'ffprobe'

const PLATFORM_KEY = `${process.platform}-${process.arch}`
const EXECUTABLE = process.platform === 'win32' ? '.exe' : ''

/**
 * The resources folder of the packaged build this code runs from, or null in a checkout.
 *
 * Read off the path rather than `process.resourcesPath`: the MCP server runs as plain node from
 * `app.asar.unpacked`, where that property does not exist, and it measures footage too.
 */
export function packagedResources(fromDir: string): string | null {
  const match = /^(.*?)[\\/]app\.asar(?:\.unpacked)?(?:[\\/]|$)/.exec(fromDir)
  return match ? match[1] : null
}

/**
 * Where ffmpeg or ffprobe is. In a packaged build, `Resources/ffmpeg/`, put there by
 * electron-builder's extraResources, because nothing can be executed from inside an asar archive.
 * In a checkout, `vendor/ffmpeg/<platform>-<arch>/`, fetched by scripts/fetchFfmpeg.mjs. Found
 * from this file's own folder, never the working directory, which is `/` for an app opened from
 * Finder.
 */
export function toolPath(tool: MediaTool, fromDir: string = __dirname): string {
  const resources = packagedResources(fromDir)
  if (resources) return join(resources, 'ffmpeg', tool + EXECUTABLE)

  // Up from src/main/media in the sources, out/main or out/mcp once built.
  let dir = fromDir
  for (let level = 0; level < 5; level++) {
    const candidate = join(dir, 'vendor', 'ffmpeg', PLATFORM_KEY, tool + EXECUTABLE)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`${tool} is not installed for ${PLATFORM_KEY}. Run \`node scripts/fetchFfmpeg.mjs --ensure\` in the Talkie folder.`)
}

export const ffmpegPath = (fromDir?: string): string => toolPath('ffmpeg', fromDir)
export const ffprobePath = (fromDir?: string): string => toolPath('ffprobe', fromDir)
