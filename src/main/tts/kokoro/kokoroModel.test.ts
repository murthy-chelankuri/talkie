import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { KOKORO_FILES, KOKORO_MODEL, isKokoroDownloaded, kokoroCacheDir, verifyKokoroDownload } from './kokoroModel'

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-kokoro-model-'))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

function revisionDir(): string {
  return join(kokoroCacheDir(baseDir), KOKORO_MODEL.id, KOKORO_MODEL.revision)
}

/** A file of `bytes` that takes no room: only its length is ever looked at, unless hashed. */
function weightsOf(bytes: number): string {
  const dir = join(revisionDir(), 'onnx')
  mkdirSync(dir, { recursive: true })
  // The small files at their published sizes; only the size is looked at here.
  for (const file of KOKORO_FILES.filter((each) => !each.path.startsWith('onnx/'))) {
    writeFileSync(join(revisionDir(), file.path), Buffer.alloc(file.bytes))
  }
  const path = join(dir, `model_${KOKORO_MODEL.dtype}.onnx`)
  writeFileSync(path, '')
  // Grown to size without writing it: a sparse file.
  truncateSync(path, bytes)
  return path
}

describe('knowing whether the voice is here', () => {
  it('is not, before anything has been downloaded', () => {
    expect(isKokoroDownloaded(baseDir)).toBe(false)
  })

  it('is not, while the weights are still arriving', () => {
    // The file is written as it downloads, so most of it can be there under the right name.
    weightsOf(KOKORO_MODEL.weightsBytes - 1_000_000)

    expect(isKokoroDownloaded(baseDir)).toBe(false)
  })

  it('is, once the whole file is there', () => {
    weightsOf(KOKORO_MODEL.weightsBytes)

    expect(isKokoroDownloaded(baseDir)).toBe(true)
  })

  it('is not, when a copy made by hand left one of the small files out', () => {
    weightsOf(KOKORO_MODEL.weightsBytes)
    rmSync(join(revisionDir(), 'config.json'))

    expect(isKokoroDownloaded(baseDir)).toBe(false)
  })

  it('keeps it beside the projects, so removing ~/Talkie removes it too', () => {
    expect(kokoroCacheDir(baseDir)).toBe(join(baseDir, 'Talkie', 'Models'))
  })
})

describe('checking a download', () => {
  it('throws away weights that are not the ones published', async () => {
    const path = weightsOf(KOKORO_MODEL.weightsBytes)

    expect(await verifyKokoroDownload(baseDir)).toBe(false)
    expect(existsSync(path)).toBe(false)
  }, 60_000)
})
