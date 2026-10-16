// Records what out/ was built from, so a checkout pulled but never rebuilt can be told apart from
// one that is up to date. See src/main/diagnostics/buildInfo.ts.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

const info = {
  version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  commit: git('rev-parse', 'HEAD'),
  dirty: Boolean(git('status', '--porcelain', '--untracked-files=no')),
  builtAt: new Date().toISOString()
}
writeFileSync(join(root, 'out', 'build-info.json'), JSON.stringify(info, null, 2) + '\n')
