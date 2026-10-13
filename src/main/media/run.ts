import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
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

export type RunningTool = { process: ChildProcessWithoutNullStreams; done: Promise<void> }

/**
 * ffmpeg as a stream — frames piped in to be encoded, or decoded frames read out — for the
 * export, which cannot hold a whole video in one buffer as runFfmpeg does.
 */
export function spawnFfmpeg(args: string[], { signal }: { signal?: AbortSignal } = {}): RunningTool {
  const child = spawn(toolPath('ffmpeg'), args, { signal, stdio: ['pipe', 'pipe', 'pipe'] })
  let said = ''
  child.stderr.on('data', (chunk: Buffer) => {
    said = (said + chunk.toString('utf-8')).slice(-8000)
  })
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, killedBy) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg failed (${killedBy ?? `exit ${code}`})\n${said.trim().split('\n').slice(-12).join('\n')}`))
    })
  })
  // A closed stdin is how the exporter says it is finished; an error writing to it after a
  // failure is reported by `done`, so it is not reported twice.
  child.stdin.on('error', () => undefined)
  return { process: child, done }
}
