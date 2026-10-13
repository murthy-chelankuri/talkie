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

// A minimal valid 16-bit PCM mono WAV (silence), built by hand so the test doesn't depend on
// any real audio asset. Structurally valid enough for headless Chromium's <Audio> to decode.
function makeSilentWavBuffer(durationSeconds = 0.1, sampleRate = 8000): Buffer {
  const numSamples = Math.floor(durationSeconds * sampleRate)
  const dataSize = numSamples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

describe('DemoComposition (real Remotion render)', () => {
  it('renders a still frame containing the image item and a narration audio track without throwing', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'demo-editor-render-test-'))
    const imagePath = join(tmpDir, 'pixel.png')
    writeFileSync(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'))
    const audioPath = join(tmpDir, 'narration.wav')
    writeFileSync(audioPath, makeSilentWavBuffer())
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
      if (req.url === '/narration.wav') {
        res.writeHead(200, { 'Content-Type': 'audio/wav' })
        res.end(readFileSync(audioPath))
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const imageUrl = `http://127.0.0.1:${port}/pixel.png`
    const audioUrl = `http://127.0.0.1:${port}/narration.wav`

    try {
      const bundleLocation = await bundle({ entryPoint: join(process.cwd(), 'src/video/remotionEntry.tsx') })
      const timeline = [{ id: 'a', kind: 'image', start: 0, duration: 90, data: { src: imageUrl, audioUrl } }]
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
