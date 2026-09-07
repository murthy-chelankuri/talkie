import { describe, expect, it } from 'vitest'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createServer } from 'http'
import { readFileSync } from 'fs'
import type { AddressInfo } from 'net'
import { COMPOSITION_ID } from '../../remotion/constants'

// A minimal valid 1x1 PNG, so the test doesn't depend on any real image asset.
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('DemoComposition (real Remotion render)', () => {
  it('renders a still frame containing the image item without throwing', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'demo-editor-render-test-'))
    const imagePath = join(tmpDir, 'pixel.png')
    writeFileSync(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'))
    const outputPath = join(tmpDir, 'frame.png')

    // NOTE: headless Chromium (both "headless-shell" and full "chrome-for-testing") hard-blocks
    // file:// subresource requests made by a page served over http:// -- even with
    // chromiumOptions.disableWebSecurity: true. This is documented, intentional Remotion/Chromium
    // behavior (see https://www.remotion.dev/docs/miscellaneous/absolute-paths), not a version
    // quirk: Remotion's own serveUrl is always an http://localhost URL (confirmed in
    // @remotion/renderer/dist/prepare-server.js), so a composition can never be loaded as a
    // file:// document, and file:// images can never be fetched as its subresources. Remotion's
    // own docs recommend exactly this workaround: serve the local folder over HTTP and use that
    // URL. We do that here with a plain Node http server (no extra dependency) so this stays a
    // real, non-mocked render. See the task report for why this matters for real project media.
    const server = createServer((req, res) => {
      if (req.url === '/pixel.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' })
        res.end(readFileSync(imagePath))
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const imageUrl = `http://127.0.0.1:${port}/pixel.png`

    try {
      const bundleLocation = await bundle({ entryPoint: join(process.cwd(), 'src/remotion/index.tsx') })
      const timeline = [{ id: 'a', kind: 'image', start: 0, duration: 90, data: { src: imageUrl } }]
      const composition = await selectComposition({ serveUrl: bundleLocation, id: COMPOSITION_ID, inputProps: { timeline } })

      await renderStill({
        composition,
        serveUrl: bundleLocation,
        output: outputPath,
        inputProps: { timeline },
        frame: 0
      })

      const { statSync } = await import('fs')
      expect(statSync(outputPath).size).toBeGreaterThan(0)
    } finally {
      server.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }, 120_000)
})
