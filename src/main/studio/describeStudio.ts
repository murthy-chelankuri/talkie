import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { studioDir } from './studio'

const run = promisify(execFile)

/** What Settings shows about the Studio: where it is, and whether it is in git yet. */
export interface StudioInfo {
  path: string
  /** The path with the home folder written as ~, for reading and for commands to copy. */
  shownPath: string
  inGit: boolean
  /** Where it is pushed to, when it has a remote. */
  remote?: string
}

export async function describeStudio(baseDir: string = homedir()): Promise<StudioInfo> {
  const path = studioDir(baseDir)
  const shownPath = path.startsWith(baseDir) ? `~${path.slice(baseDir.length)}` : path
  const inGit = existsSync(join(path, '.git'))
  if (!inGit) return { path, shownPath, inGit }
  try {
    const { stdout } = await run('git', ['-C', path, 'remote', 'get-url', 'origin'], { timeout: 5000 })
    return { path, shownPath, inGit, remote: stdout.trim() || undefined }
  } catch {
    // No remote yet, or no git on this Mac: either way, there is nothing to name.
    return { path, shownPath, inGit }
  }
}
