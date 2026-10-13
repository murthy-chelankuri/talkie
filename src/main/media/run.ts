import { execFile } from 'child_process'
import { toolPath, type MediaTool } from './binaries'

export type ToolOutput = { stdout: string; stderr: string }

/** As much output as an ffmpeg run may print. Loudness measurement reads a JSON block off it. */
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024

/**
 * Runs ffmpeg with exactly the arguments given — no log level and no `-y` added — so a caller
 * reads the same output it always has.
 */
export function runFfmpeg(args: string[], options: { signal?: AbortSignal } = {}): Promise<ToolOutput> {
  return run('ffmpeg', args, options.signal)
}

export function runFfprobe(args: string[], options: { signal?: AbortSignal } = {}): Promise<ToolOutput> {
  return run('ffprobe', args, options.signal)
}

function run(tool: MediaTool, args: string[], signal: AbortSignal | undefined): Promise<ToolOutput> {
  return new Promise((resolve, reject) => {
    execFile(toolPath(tool), args, { maxBuffer: MAX_OUTPUT_BYTES, signal, encoding: 'utf-8' }, (error, stdout, stderr) => {
      if (error) {
        // The last lines are where ffmpeg says what went wrong; the rest is its stream listing.
        const said = stderr.trim().split('\n').slice(-12).join('\n')
        reject(new Error(`${tool} failed: ${error.message}${said ? `\n${said}` : ''}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}
