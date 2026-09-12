import { access, readdir } from 'fs/promises'
import { constants } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'

/**
 * Where a command-line tool actually lives.
 *
 * An app launched from Finder inherits almost no PATH — `/usr/bin:/bin:/usr/sbin:/sbin` and
 * little else — while the tools this app shells out to are installed by Homebrew or by a global
 * npm, neither of which is on that list. Running from a terminal hides the problem completely,
 * because there PATH comes from the user's shell profile, so the packaged app is the only place
 * it shows up: a CLI the user can run themselves, reported as not installed.
 *
 * So rather than trusting PATH, look through it *and* the handful of places these tools are
 * normally put.
 */
const HOME = homedir()

const COMMON_BIN_DIRS = [
  '/opt/homebrew/bin', // Homebrew, Apple silicon
  '/usr/local/bin', // Homebrew on Intel, and npm's default global prefix
  '/usr/bin',
  join(HOME, '.local', 'bin'),
  join(HOME, '.npm-global', 'bin'),
  join(HOME, 'node_modules', '.bin'),
  join(HOME, '.bun', 'bin'),
  join(HOME, '.volta', 'bin'),
  join(HOME, '.asdf', 'shims')
]

/** Every node version nvm has installed keeps its own bin directory. */
async function nvmBinDirs(): Promise<string[]> {
  const versions = join(HOME, '.nvm', 'versions', 'node')
  try {
    return (await readdir(versions)).map((version) => join(versions, version, 'bin'))
  } catch {
    return []
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * The absolute path to `name`, or null if it is not installed.
 *
 * PATH is searched first so a user who has deliberately put one version ahead of another keeps
 * the one they chose.
 */
export async function findCli(name: string): Promise<string | null> {
  const fromPath = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const candidates = [...fromPath, ...COMMON_BIN_DIRS, ...(await nvmBinDirs())]

  const seen = new Set<string>()
  for (const dir of candidates) {
    if (seen.has(dir)) continue
    seen.add(dir)

    const candidate = join(dir, name)
    if (await isExecutable(candidate)) return candidate
  }

  return null
}
