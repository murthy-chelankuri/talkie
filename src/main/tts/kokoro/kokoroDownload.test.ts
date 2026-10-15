import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { KOKORO_FILES, kokoroModelDir, type KokoroFile } from './kokoroModel'
import { fetchKokoroFiles } from './kokoroDownload'
import { downloadKokoro } from './kokoroProcess'

/**
 * Hugging Face, or a proxy standing in front of it, played by a local server. The three small
 * files are the real ones (see fixtures/), so they are checked against their real hashes; the
 * 163 MB weights are left out of these, and fetched for real only by the app.
 */
const FIXTURES = join(__dirname, 'fixtures', 'kokoro-small-files')
const SMALL = KOKORO_FILES.filter((file) => !file.path.startsWith('onnx/'))

let server: Server
let base: string
let baseDir: string
/** What the server says to each path; a file's own bytes unless a test says otherwise. */
let answer: (path: string) => { status: number; body: Buffer }
const asked: string[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').slice(1)
    asked.push(path)
    const { status, body } = answer(path)
    res.writeHead(status, { 'Content-Length': body.length })
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-kokoro-download-'))
  asked.length = 0
  answer = (path) => ({ status: 200, body: readFileSync(join(FIXTURES, path)) })
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

const urlFor = (file: KokoroFile): string => `${base}/${file.path}`
const fetchFile = (url: string): Promise<Response> => fetch(url)

describe('fetching the Kokoro voice', () => {
  it('puts every file in place, checked, saying how far it has got', async () => {
    const progress: [number, number][] = []

    await fetchKokoroFiles(fetchFile, (loaded, total) => progress.push([loaded, total]), baseDir, SMALL, urlFor)

    for (const file of SMALL) {
      expect(readFileSync(join(kokoroModelDir(baseDir), file.path))).toEqual(readFileSync(join(FIXTURES, file.path)))
    }
    const total = SMALL.reduce((sum, file) => sum + file.bytes, 0)
    expect(progress.at(-1)).toEqual([total, total])
  })

  it('carries on from where an interrupted download stopped, rather than starting again', async () => {
    mkdirSync(kokoroModelDir(baseDir), { recursive: true })
    copyFileSync(join(FIXTURES, 'tokenizer.json'), join(kokoroModelDir(baseDir), 'tokenizer.json'))

    await fetchKokoroFiles(fetchFile, undefined, baseDir, SMALL, urlFor)

    expect(asked.sort()).toEqual(['config.json', 'tokenizer_config.json'])
  })

  it('throws away a proxy’s page that arrives in place of a file, and says so', async () => {
    answer = (path) =>
      path === 'tokenizer.json'
        ? { status: 200, body: Buffer.from('<html><body>This site is blocked by your organisation.</body></html>') }
        : { status: 200, body: readFileSync(join(FIXTURES, path)) }

    await expect(fetchKokoroFiles(fetchFile, undefined, baseDir, SMALL, urlFor)).rejects.toThrow(
      /tokenizer\.json did not match the published one.*proxy/
    )
    expect(existsSync(join(kokoroModelDir(baseDir), 'tokenizer.json'))).toBe(false)
    expect(readdirSync(kokoroModelDir(baseDir)).filter((name) => name.endsWith('.partial'))).toEqual([])
  })

  it('names a proxy that wants signing in to', async () => {
    // Handed over directly: Node's own fetch turns a 407 into a bare "fetch failed" before anyone
    // sees the status, and the point here is what Talkie says when it does see one.
    const wantsSignIn = async (): Promise<Response> => new Response('Proxy Authentication Required', { status: 407 })

    await expect(fetchKokoroFiles(wantsSignIn, undefined, baseDir, SMALL, urlFor)).rejects.toThrow(
      /refused \(HTTP 407\) by a proxy that wants signing in to/
    )
  })

  it('tells the person a proxy stopped it, and where to go instead', async () => {
    // As Electron's network reports a proxy that cannot be reached, or one whose certificate is
    // not trusted: before any file arrives.
    const refused = (): Promise<Response> => Promise.reject(new Error('net::ERR_PROXY_CONNECTION_FAILED'))

    await expect(downloadKokoro(baseDir, refused)).rejects.toThrow(
      'A proxy or firewall stopped the download from Hugging Face. Download the files yourself and add them below.'
    )
  })
})
