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
import { phonemize } from 'phonemizer'
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
 * The model, loaded once per process and kept, from files already on disk.
 *
 * Loading reads a few hundred megabytes off disk; every clip after the first reuses it. This
 * process never fetches anything: Node's own network ignores the Mac's proxy and its keychain, so
 * on a corporate network it could not reach Hugging Face where the browser could. The main process
 * fetches the files through Electron's network instead (kokoroDownload.ts), and a `prepare` here
 * only proves they load.
 */
function model(spec: Model): Promise<KokoroTTS> {
  const key = `${spec.id}@${spec.revision}:${spec.dtype}`
  if (loaded?.key === key) return loaded.tts

  env.cacheDir = spec.cacheDir
  env.allowLocalModels = false
  // transformers.js will not run with both sources off, even when everything is cached. So the
  // "remote" is a port nothing listens on: a cached model loads as normal, and a missing one fails
  // at once instead of quietly starting a download of its own.
  env.allowRemoteModels = true
  env.remoteHost = 'http://127.0.0.1:9/'

  // Loaded through the two halves directly rather than KokoroTTS.from_pretrained, because only
  // this way can the revision be pinned: a model that changed upstream should not change how
  // narration sounds without anyone choosing it.
  const tts = Promise.all([
    StyleTextToSpeech2Model.from_pretrained(spec.id, {
      revision: spec.revision,
      dtype: spec.dtype,
      device: 'cpu'
    }),
    AutoTokenizer.from_pretrained(spec.id, { revision: spec.revision })
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

/**
 * How much Kokoro is given to read at once, in phoneme characters.
 *
 * The model reads at most 510 tokens — about one phoneme each — and kokoro-js cuts anything longer
 * off without a word: a 150-word paragraph came back as 25 seconds of its first two thirds, and
 * the rest of the narration was simply missing from the clip. Measured here with the same
 * phonemizer Kokoro uses, but before Kokoro's own clean-up of numbers and symbols, which can
 * lengthen a line a little; the margin is for that.
 */
const PHONEME_BUDGET = 400

async function phonemeLength(text: string): Promise<number> {
  return (await phonemize(text, 'en-us')).join(' ').length
}

/** Smaller pieces of one too-long piece: clauses first, then words, so a cut falls at a pause. */
function splitFurther(text: string): string[] {
  const clauses = text.split(/(?<=[,;:\u2014\u2013])\s+/).filter(Boolean)
  if (clauses.length > 1) return clauses
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 2) return [text]
  const half = Math.ceil(words.length / 2)
  return [words.slice(0, half).join(' '), words.slice(half).join(' ')]
}

/**
 * The words in pieces Kokoro can read whole, in order.
 *
 * A take that fits is read in one go, as it always was — Kokoro shapes a paragraph as a paragraph,
 * and reading every clip sentence by sentence would change how all of them sound. Only a take
 * over the limit is cut, at sentence ends where it can be, and the pieces are packed back
 * together as far as each will go.
 */
async function piecesToRead(text: string): Promise<string[]> {
  if ((await phonemeLength(text)) <= PHONEME_BUDGET) return [text]

  const queue = text.split(/(?<=[.!?\u2026])\s+|\n+/).map((each) => each.trim()).filter(Boolean)
  const units: string[] = []
  while (queue.length > 0) {
    const unit = queue.shift() as string
    const smaller = (await phonemeLength(unit)) > PHONEME_BUDGET ? splitFurther(unit) : [unit]
    if (smaller.length > 1) queue.unshift(...smaller)
    else units.push(unit)
  }

  const pieces: string[] = []
  for (const unit of units) {
    const joined = pieces.length > 0 ? `${pieces[pieces.length - 1]} ${unit}` : null
    if (joined && (await phonemeLength(joined)) <= PHONEME_BUDGET) pieces[pieces.length - 1] = joined
    else pieces.push(unit)
  }
  return pieces
}

async function speak(tts: KokoroTTS, text: string, voice: KokoroVoice, speed: number): Promise<{ samples: Float32Array; sampleRate: number }> {
  const parts: Float32Array[] = []
  let sampleRate = 24_000
  for (const piece of await piecesToRead(text)) {
    const audio = await tts.generate(piece, { voice, speed })
    parts.push(audio.audio)
    sampleRate = audio.sampling_rate
  }
  const samples = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    samples.set(part, offset)
    offset += part.length
  }
  return { samples, sampleRate }
}

function reply(message: Reply): void {
  process.send?.(message)
}

async function handle(request: Request): Promise<void> {
  try {
    if (request.kind === 'prepare') {
      await model(request.model)
      reply({ id: request.id, kind: 'done' })
      return
    }

    const tts = await model(request.model)
    const { samples, sampleRate } = await speak(tts, request.text, request.voice as KokoroVoice, request.speed)
    writeFileSync(request.outputPath, toWav(samples, sampleRate))
    reply({ id: request.id, kind: 'done', seconds: samples.length / sampleRate })
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
