import { statSync } from 'fs'
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

export interface KokoroFile {
  /** Where it sits inside the revision's folder, which is also its path on Hugging Face. */
  path: string
  bytes: number
  sha256: string
}

/**
 * Everything Kokoro reads at that revision, and nothing else: what a download leaves on disk.
 *
 * Pinned to the byte, so a copy brought in by hand can be checked as strictly as one Talkie
 * fetched. That matters most behind a proxy, which answers a blocked request with a page of its
 * own — saved under the right name, it looks like the file until the model fails to load.
 */
export const KOKORO_FILES: KokoroFile[] = [
  { path: 'config.json', bytes: 44, sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f' },
  { path: 'tokenizer.json', bytes: 3497, sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34' },
  { path: 'tokenizer_config.json', bytes: 113, sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20' },
  { path: `onnx/model_${KOKORO_MODEL.dtype}.onnx`, bytes: KOKORO_MODEL.weightsBytes, sha256: KOKORO_MODEL.weightsSha256 }
]

/** Where a file can be fetched by hand: the pinned revision, not whatever is newest. */
export function kokoroFileUrl(file: KokoroFile): string {
  return `https://huggingface.co/${KOKORO_MODEL.id}/resolve/${KOKORO_MODEL.revision}/${file.path}`
}

/** Beside the projects and the settings, so removing ~/Talkie removes this too. */
export function kokoroCacheDir(baseDir: string = homedir()): string {
  return join(baseDir, 'Talkie', 'Models')
}

/** Where transformers.js keeps a pinned revision inside the cache: `<id>/<revision>/…`. */
export function kokoroModelDir(baseDir: string = homedir()): string {
  return revisionDir(baseDir)
}

function revisionDir(baseDir: string): string {
  return join(kokoroCacheDir(baseDir), KOKORO_MODEL.id, KOKORO_MODEL.revision)
}

/**
 * Whether the model is on disk, whole.
 *
 * By exact size, because the weights are written to disk as they arrive: a file part way through
 * its download has the right name and most of the bytes, and anything looser than the exact size
 * called a half-written model ready. Cheap enough to ask on every clip; the hash is checked once,
 * as each file arrives — see kokoroDownload.ts.
 */
export function isKokoroDownloaded(baseDir: string = homedir()): boolean {
  try {
    // Every file, at its size. A download writes them all, but a copy made by hand can leave one
    // out, and Kokoro cannot load without any of them while it is kept off the network.
    return KOKORO_FILES.every((file) => statSync(join(revisionDir(baseDir), file.path)).size === file.bytes)
  } catch {
    return false
  }
}
