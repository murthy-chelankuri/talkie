import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

/**
 * Kokoro stays in a process of its own.
 *
 * Its phonemizer carries eSpeak NG, which is GPL-3.0. Run as a separate program the app talks to
 * over a pipe, it is shipped alongside Talkie — the footing the GPL ffmpeg inside Remotion's
 * compositor is already on. Imported anywhere the main process, the windows or the MCP server
 * load, it would sit in one program with Remotion, whose licence is not GPL-compatible, and no
 * failing build or test would say so. This one does.
 *
 * Read off the source rather than run, because the mistake it guards against — one convenient
 * import — works perfectly in every other respect.
 */
const SRC = join(__dirname, '..', '..', '..')
const WORKER = join(__dirname, 'kokoroWorker.ts')

/** What only the worker may load: the model's runtime, and the phonemizer inside it. */
const WORKER_ONLY = ['kokoro-js', 'phonemizer', '@huggingface/transformers', 'onnxruntime-node']

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.(ts|tsx)$/.test(entry) && !entry.includes('.test.')) found.push(path)
  }
  return found
}

function imports(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1])
}

describe('the line around Kokoro', () => {
  it('finds the worker importing Kokoro, so a regex that matched nothing cannot pass', () => {
    expect(imports(readFileSync(WORKER, 'utf-8'))).toContain('kokoro-js')
  })

  it('lets nothing but the worker load Kokoro or its phonemizer', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => file !== WORKER)
      .flatMap((file) =>
        imports(readFileSync(file, 'utf-8'))
          .filter((specifier) => WORKER_ONLY.some((name) => specifier === name || specifier.startsWith(`${name}/`)))
          .map((specifier) => `${relative(SRC, file)} imports ${specifier}`)
      )

    expect(offenders).toEqual([])
  })

  it('lets nothing import the worker itself — it is forked, never loaded', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => imports(readFileSync(file, 'utf-8')).some((specifier) => /kokoroWorker(\.ts)?$/.test(specifier)))
      .map((file) => relative(SRC, file))

    expect(offenders).toEqual([])
  })

  it('keeps the worker free of the rest of the app, so the boundary is one whole file', () => {
    const local = imports(readFileSync(WORKER, 'utf-8')).filter((specifier) => specifier.startsWith('.'))

    expect(local).toEqual([])
  })
})
