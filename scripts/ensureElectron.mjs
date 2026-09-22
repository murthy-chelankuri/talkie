/**
 * Check Electron's binary is really there before trying to run it.
 *
 * The `electron` package is a stub: the ~100MB binary is fetched by its own postinstall. When
 * that does not happen the stub throws "Electron failed to install correctly" at the moment
 * `npm run dev` starts, which reads as the app being broken rather than as an install that never
 * finished — and the advice in it is a repair step, not a cause.
 *
 * Three things stop the download, and only one is obvious:
 *
 *   ignore-scripts=true   set globally by plenty of corporate and security setups, and by
 *                         `npm ci --ignore-scripts`. Nothing warns you.
 *   a blocked download    the binary comes from github.com/electron/electron/releases, which a
 *                         proxy or VPN may refuse.
 *   an interrupted install
 *
 * This runs from inside the `dev` script rather than as a `predev` hook, because `ignore-scripts`
 * skips pre and post hooks too — the setting that causes the commonest form of this failure would
 * also disable the check for it. A script npm was asked for by name still runs.
 */
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')

function installed() {
  const pathFile = join(electronDir, 'path.txt')
  if (!existsSync(pathFile)) return false

  // path.txt names the binary inside dist. Both have to be there: a dist directory left half
  // written by an interrupted download passes a check for the directory alone.
  try {
    return existsSync(join(electronDir, 'dist', readFileSync(pathFile, 'utf-8').trim()))
  } catch {
    return false
  }
}

if (!existsSync(electronDir)) {
  console.error('\nElectron is not installed at all. Run `npm install` first.\n')
  process.exit(1)
}

if (!installed()) {
  console.error('Electron is installed but its binary was never downloaded — fetching it now.')
  try {
    execFileSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
  } catch {
    // Said plainly, because the stub's own message names a repair and not one of these.
    console.error(
      [
        '',
        'Could not download the Electron binary. The usual reasons:',
        '',
        '  1. npm is set not to run install scripts, which is what fetches it:',
        '       npm config get ignore-scripts        # must be false',
        '       npm config set ignore-scripts false',
        '',
        '  2. The download is blocked. It comes from github.com/electron/electron/releases,',
        '     which some networks refuse. A mirror works:',
        '       ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js',
        '',
        '  3. ELECTRON_SKIP_BINARY_DOWNLOAD is set in your environment.',
        ''
      ].join('\n')
    )
    process.exit(1)
  }

  if (!installed()) {
    console.error('\nThe download reported success but the binary is still missing.\n')
    process.exit(1)
  }
  console.error('Electron is ready.\n')
}
