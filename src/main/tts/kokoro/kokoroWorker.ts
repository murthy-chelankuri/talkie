/**
 * Kokoro, in a process of its own.
 *
 * This is the only file that loads `kokoro-js`, and it runs as a separate program the app talks to
 * over a pipe — never inside the main process. The reason is a licence, not performance: Kokoro
 * turns text into phonemes with `phonemizer`, which carries eSpeak NG compiled into it, and eSpeak
 * NG is GPL-3.0. Loaded into the main process it would make it and the app one program, which the
 * GPL would then govern as a whole. Run beside it and spoken to with plain messages, it is a
 * separate program shipped alongside — the same footing as the GPL ffmpeg Talkie runs. See NOTICE,
 * and `kokoroBoundary.test.ts`, which holds the line.
 *
 * Kept free of imports from the rest of the app, so the boundary is a whole file and nothing the
 * main process loads can drag this in. What it needs is handed to it in each message.
 */
import { writeFileSync } from 'fs'
import { KokoroTTS } from 'kokoro-js'
import { AutoTokenizer, StyleTextToSpeech2Model, env } from '@huggingface/transformers'

interface Model {
  id: string
  revision: string
  dtype: 'fp32' | 'fp16' | 'q8'
  cacheDir: string
}

type Request =
  | { id: number; kind: 'prepare'; model: Model }
  | { id: number; kind: 'speak'; model: Model; text: string; voice: string; speed: number; outputPath: string }

type Reply =
  | { id: number; kind: 'progress'; loaded: number; total: number }
  | { id: number; kind: 'done'; seconds?: number }
  | { id: number; kind: 'error'; message: string }

type KokoroVoice = NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice']

let loaded: { key: string; tts: Promise<KokoroTTS> } | null = null

/**
 * The model, loaded once per process and kept.
 *
 * Loading reads a few hundred megabytes off disk; every clip after the first reuses it. Only a
 * `prepare` may fetch it from the network — a `speak` that finds it missing fails, rather than
 * quietly starting a large download in the middle of narrating a clip.
 */
function model(spec: Model, allowDownload: boolean, onProgress?: (loaded: number, total: number) => void): Promise<KokoroTTS> {
  const key = `${spec.id}@${spec.revision}:${spec.dtype}`
  if (loaded?.key === key) return loaded.tts

  env.cacheDir = spec.cacheDir
  env.allowLocalModels = false
  // transformers.js will not run with both sources off, even when everything is cached. So when
  // speaking, the "remote" is a port nothing listens on: a cached model loads as normal, and a
  // missing one fails at once instead of quietly starting a download mid-narration.
  env.allowRemoteModels = true
  env.remoteHost = allowDownload ? 'https://huggingface.co/' : 'http://127.0.0.1:9/'

  // Bytes per file, summed: the model and its tokenizer come down as several files at once.
  const files = new Map<string, { loaded: number; total: number }>()
  const progress_callback = (event: { status: string; file?: string; loaded?: number; total?: number }): void => {
    if (event.status !== 'progress' || !event.file || !onProgress) return
    files.set(event.file, { loaded: event.loaded ?? 0, total: event.total ?? 0 })
    let sumLoaded = 0
    let sumTotal = 0
    for (const file of files.values()) {
      sumLoaded += file.loaded
      sumTotal += file.total
    }
    onProgress(sumLoaded, sumTotal)
  }

  // Loaded through the two halves directly rather than KokoroTTS.from_pretrained, because only
  // this way can the revision be pinned: a model that changed upstream should not change how
  // narration sounds without anyone choosing it.
  const tts = Promise.all([
    StyleTextToSpeech2Model.from_pretrained(spec.id, {
      revision: spec.revision,
      dtype: spec.dtype,
      device: 'cpu',
      progress_callback
    }),
    AutoTokenizer.from_pretrained(spec.id, { revision: spec.revision, progress_callback })
  ]).then(([m, tokenizer]) => new KokoroTTS(m, tokenizer))

  loaded = { key, tts }
  // A failed load is not kept, or every later request would get the same failure.
  tts.catch(() => {
    if (loaded?.tts === tts) loaded = null
  })
  return tts
}

/**
 * 16-bit PCM, which is what every other take in the app is.
 *
 * Kokoro hands back 32-bit floats, and its own `save` writes them as a float wav. The takes of a
 * timed narration are spliced by copying samples, so one float take among 16-bit ones would be
 * read as integers — loud noise, not speech.
 */
function toWav(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    data.writeInt16LE(Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), i * 2)
  }

  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(sampleRate, 24)
  head.writeUInt32LE(sampleRate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

function reply(message: Reply): void {
  process.send?.(message)
}

async function handle(request: Request): Promise<void> {
  try {
    if (request.kind === 'prepare') {
      await model(request.model, true, (done, total) => reply({ id: request.id, kind: 'progress', loaded: done, total }))
      reply({ id: request.id, kind: 'done' })
      return
    }

    const tts = await model(request.model, false)
    const audio = await tts.generate(request.text, { voice: request.voice as KokoroVoice, speed: request.speed })
    writeFileSync(request.outputPath, toWav(audio.audio, audio.sampling_rate))
    reply({ id: request.id, kind: 'done', seconds: audio.audio.length / audio.sampling_rate })
  } catch (err) {
    reply({ id: request.id, kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

// One at a time: every request shares one model, and a clip is only ever waited on in order.
let queue: Promise<void> = Promise.resolve()
process.on('message', (request: Request) => {
  queue = queue.then(() => handle(request))
})
/**
 * Gone with the app: an orphaned process holding a model in memory helps nobody.
 *
 * Ended by signal rather than process.exit. onnxruntime's own C++ teardown aborts on macOS during
 * an ordinary exit ("mutex lock failed") — releasing the model first did not stop it — and an
 * abort is a crash report every time the app quits or the worker goes idle. A signal skips that
 * teardown. Nothing is lost: every clip is written before its reply, and this only runs once
 * nothing is waiting.
 */
process.on('disconnect', () => process.kill(process.pid, 'SIGTERM'))
