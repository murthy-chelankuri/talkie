import { createServer, type Server } from 'http'
import { existsSync, readFileSync, statSync } from 'fs'
import { extname, join, normalize, sep } from 'path'
import type { AddressInfo } from 'net'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
}

/** The demo apps under `examples/apps/`, as the build records them. */
export const APPS_DIR = join(__dirname, '..', 'apps')

/**
 * Serve one of the demo apps on loopback for as long as a build needs it. The recorder and the
 * theme reader both want a real address, and an app on a port of its own is what they meet in use.
 */
export async function serveApp(name: string): Promise<{ url: string; close: () => Promise<void> }> {
  const root = join(APPS_DIR, name)
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split(/[?#]/)[0])
    const file = normalize(join(root, path === '/' ? 'index.html' : path))
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
