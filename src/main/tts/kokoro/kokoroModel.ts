import { createHash } from 'crypto'
import { createReadStream, existsSync, rmSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Which Kokoro, and where it is kept.
 *
 * The weights are Apache-2.0, published by the model's author and converted to ONNX by the
 * onnx-community organisation on Hugging Face; the model card says it was trained only on
 * permissively licensed audio. They are fetched once, the first time someone chooses Kokoro,
 * rather than shipped in the installer: most people who install Talkie may never pick it, and
 * the file is larger than the rest of the app's own code.
 */
export const KOKORO_MODEL = {
  id: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  // Pinned. A model that changed upstream should not change how narration sounds, or what was
  // downloaded, without anyone choosing it.
  revision: '1939ad2a8e416c0acfeecc08a694d14ef25f2231',
  // Half precision: measured on an M-series Mac it reads as fast as the full model and sounds
  // the same, at half the download. The 8-bit version is smaller again but took twice as long.
  dtype: 'fp16' as const,
  /** The weights at that revision, as Hugging Face lists them. */
  weightsBytes: 163_234_740,
  weightsSha256: 'ba4527a874b42b21e35f468c10d326fdff3c7fc8cac1f85e9eb6c0dfc35c334a'
}

/** What the download is, said to the person about to start it. */
export const KOKORO_DOWNLOAD_MB = 163

/** Beside the projects and the settings, so removing ~/Talkie removes this too. */
export function kokoroCacheDir(baseDir: string = homedir()): string {
  return join(baseDir, 'Talkie', 'Models')
}

/** Where transformers.js keeps a pinned revision inside the cache: `<id>/<revision>/…`. */
function revisionDir(baseDir: string): string {
  return join(kokoroCacheDir(baseDir), KOKORO_MODEL.id, KOKORO_MODEL.revision)
}

function weightsPath(baseDir: string): string {
  return join(revisionDir(baseDir), 'onnx', `model_${KOKORO_MODEL.dtype}.onnx`)
}

/**
 * Whether the model is on disk, whole.
 *
 * By exact size, because the weights are written to disk as they arrive: a file part way through
 * its download has the right name and most of the bytes, and anything looser than the exact size
 * called a half-written model ready. Cheap enough to ask on every clip; the hash is checked once,
 * when the download finishes — see verifyKokoroDownload.
 */
export function isKokoroDownloaded(baseDir: string = homedir()): boolean {
  try {
    return (
      existsSync(join(revisionDir(baseDir), 'tokenizer.json')) &&
      statSync(weightsPath(baseDir)).size === KOKORO_MODEL.weightsBytes
    )
  } catch {
    return false
  }
}

/**
 * Check what arrived is what was published, and throw away anything that is not.
 *
 * A model is code the app runs on every clip; a corrupted file fails in ways that look like bugs,
 * and a substituted one is the reason pinning a revision is worth doing at all.
 */
export async function verifyKokoroDownload(baseDir: string = homedir()): Promise<boolean> {
  const path = weightsPath(baseDir)
  const hash = createHash('sha256')
  try {
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  } catch {
    return false
  }
  if (hash.digest('hex') === KOKORO_MODEL.weightsSha256) return true
  rmSync(path, { force: true })
  return false
}
