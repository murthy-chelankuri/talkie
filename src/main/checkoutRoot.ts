import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'

/**
 * The checkout Talkie is running from, found by walking up from `fromDir` to Talkie's own
 * package.json with its sources beside it. Null in a packaged build, which ships no sources.
 *
 * Not a fixed number of `..` from `__dirname`: the same file runs from three depths. The tests
 * run it from its place in `src/`, while the app runs it bundled into `out/main` and the MCP
 * server into `out/mcp`. A count that is right for one is wrong for the others, and the wrong
 * one only shows where nothing was built first — `npm run dev` straight after a download —
 * where export looked for its page two folders above the repository and the app fell over.
 */
export function checkoutRoot(fromDir: string = __dirname): string | null {
  let dir = fromDir
  for (;;) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest) && existsSync(join(dir, 'src'))) {
      try {
        if (JSON.parse(readFileSync(manifest, 'utf-8')).name === 'talkie') return dir
      } catch {
        // Unreadable is not Talkie's; keep looking.
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** The checkout, for code that only runs from one; says so plainly rather than guessing a path. */
export function requireCheckoutRoot(what: string, fromDir: string = __dirname): string {
  const root = checkoutRoot(fromDir)
  if (!root) throw new Error(`${what} is not built into this copy of Talkie, and there are no sources to build it from.`)
  return root
}
