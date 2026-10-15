import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { KOKORO_FILES, KOKORO_MODEL, isKokoroDownloaded, kokoroModelDir } from './kokoroModel'
import { checkKokoroFiles, importKokoroFiles, kokoroManual } from './kokoroManual'
import { speakWithKokoro, stopKokoro } from './kokoroProcess'

/**
 * The three small files exactly as Hugging Face serves them at the pinned revision, so the
 * recognising can be tested on the real thing. The weights are 163 MB and are borrowed from a
 * downloaded voice when there is one.
 */
const FIXTURES = join(__dirname, 'fixtures', 'kokoro-small-files')
const SMALL = ['config.json', 'tokenizer.json', 'tokenizer_config.json']
const WEIGHTS = KOKORO_FILES.find((file) => file.path.startsWith('onnx/'))!
const DOWNLOADED_WEIGHTS = join(kokoroModelDir(homedir()), WEIGHTS.path)
const haveWeights = existsSync(DOWNLOADED_WEIGHTS) && statSync(DOWNLOADED_WEIGHTS).size === WEIGHTS.bytes

let baseDir: string
let downloads: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-kokoro-manual-'))
  downloads = join(baseDir, 'Downloads')
  mkdirSync(downloads)
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

afterAll(() => stopKokoro())

/** A file saved by a browser: same contents, whatever name the browser chose. */
function saved(fixture: string, as: string): string {
  const path = join(downloads, as)
  copyFileSync(join(FIXTURES, fixture), path)
  return path
}

describe('the instructions for downloading the voice by hand', () => {
  it('link every file at the pinned revision, not whatever is newest', () => {
    const manual = kokoroManual(baseDir)

    expect(manual.files.map((file) => file.path)).toEqual(KOKORO_FILES.map((file) => file.path))
    for (const file of manual.files) {
      expect(file.url).toBe(`https://huggingface.co/${KOKORO_MODEL.id}/resolve/${KOKORO_MODEL.revision}/${file.path}`)
      expect(manual.instructions).toContain(file.url)
      expect(manual.instructions).toContain(file.sha256)
    }
  })

  it('say where the files go, and how to hand them to Talkie', () => {
    const manual = kokoroManual(baseDir)

    expect(manual.folder).toBe(join(baseDir, 'Talkie', 'Models', KOKORO_MODEL.id, KOKORO_MODEL.revision))
    expect(manual.instructions).toContain(join(manual.folder, 'onnx', `model_${KOKORO_MODEL.dtype}.onnx`))
    expect(manual.instructions).toContain('Choose downloaded files')
  })

  it('match the files Talkie checks, byte for byte', () => {
    for (const name of SMALL) {
      const file = KOKORO_FILES.find((each) => each.path === name)!
      expect(readFileSync(join(FIXTURES, name)).length).toBe(file.bytes)
    }
  })
})

describe('adding files downloaded by hand', () => {
  it('recognises each by its contents, whatever the browser named it', async () => {
    const result = await importKokoroFiles(
      [saved('config.json', 'config (1).json'), saved('tokenizer.json', 'tokenizer.json.download'), saved('tokenizer_config.json', 'download')],
      baseDir
    )

    expect(result.placed.sort()).toEqual([...SMALL].sort())
    expect(result.unrecognised).toEqual([])
    for (const name of SMALL) {
      expect(readFileSync(join(kokoroModelDir(baseDir), name))).toEqual(readFileSync(join(FIXTURES, name)))
    }
  })

  it('says what is still needed, and is not ready without it', async () => {
    const result = await importKokoroFiles([saved('config.json', 'config.json')], baseDir)

    expect(result.ready).toBe(false)
    expect(result.missing).toEqual(['tokenizer.json', 'tokenizer_config.json', WEIGHTS.path])
    expect(isKokoroDownloaded(baseDir)).toBe(false)
  })

  it('refuses a proxy’s page saved under the right name, and leaves it where it was', async () => {
    const blocked = join(downloads, 'config.json')
    writeFileSync(blocked, '<html><body>Access to huggingface.co is blocked by policy.</body></html>')

    const result = await importKokoroFiles([blocked], baseDir)

    expect(result.placed).toEqual([])
    expect(result.unrecognised).toEqual(['config.json'])
    expect(existsSync(join(kokoroModelDir(baseDir), 'config.json'))).toBe(false)
    expect(existsSync(blocked)).toBe(true)
  })

  it('refuses weights of the right size that are not the published ones', async () => {
    const fake = join(downloads, WEIGHTS.path.split('/').pop()!)
    writeFileSync(fake, '')
    truncateSync(fake, WEIGHTS.bytes)

    const result = await importKokoroFiles([fake], baseDir)

    expect(result.unrecognised).toEqual([`model_${KOKORO_MODEL.dtype}.onnx`])
    expect(existsSync(join(kokoroModelDir(baseDir), WEIGHTS.path))).toBe(false)
  }, 60_000)

  it.skipIf(!haveWeights)('makes a voice that speaks, kept off the network, once all four are in', async () => {
    const weights = join(downloads, 'model_fp16 (1).onnx')
    copyFileSync(DOWNLOADED_WEIGHTS, weights)

    const result = await importKokoroFiles(
      [weights, ...SMALL.map((name) => saved(name, name))],
      baseDir
    )

    expect(result).toMatchObject({ ready: true, missing: [], wrong: [], unrecognised: [] })
    expect(isKokoroDownloaded(baseDir)).toBe(true)
    expect(existsSync(join(kokoroModelDir(baseDir), `${WEIGHTS.path}.partial`))).toBe(false)

    // Speaking never downloads, so this is read from the files just placed and nothing else.
    const seconds = await speakWithKokoro('Added by hand.', 'af_heart', 1, join(baseDir, 'take.wav'), baseDir)
    expect(seconds).toBeGreaterThan(0.3)
  }, 90_000)
})

describe('checking files copied in by hand', () => {
  it('names a file that is there but is not the published one, without deleting it', async () => {
    const folder = kokoroModelDir(baseDir)
    mkdirSync(folder, { recursive: true })
    for (const name of SMALL) copyFileSync(join(FIXTURES, name), join(folder, name))
    writeFileSync(join(folder, 'tokenizer.json'), 'not a tokenizer')

    const result = await checkKokoroFiles(baseDir)

    expect(result).toEqual({ ready: false, missing: [WEIGHTS.path], wrong: ['tokenizer.json'] })
    expect(readFileSync(join(folder, 'tokenizer.json'), 'utf-8')).toBe('not a tokenizer')
  })
})
