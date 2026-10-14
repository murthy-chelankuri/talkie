import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg, runFfprobe } from '../../../media'

/** What the comparison measures (spec §3, "Proof"): frames, pictures, loudness, silences. */
export async function frameCount(path: string): Promise<number> {
  const { stdout } = await runFfprobe(['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'default=noprint_wrappers=1:nokey=1', path])
  return Number(stdout.trim())
}

export async function rgbFrame(path: string, seconds: number): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-measure-'))
  try {
    const out = join(dir, 'frame.rgb')
    await runFfmpeg(['-v', 'error', '-ss', seconds.toFixed(4), '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-y', out])
    return readFileSync(out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Mean absolute per-channel difference, and the worst single difference outside a 2-pixel margin
 * of edges in either picture. Text is anti-aliased differently by any two renders; everywhere
 * else the pictures should agree closely.
 */
export function pictureDifference(a: Buffer, b: Buffer, width: number, height: number): { mean: number; worstOutsideEdges: number } {
  const luma = (buf: Buffer, i: number): number => 0.2126 * buf[i * 3] + 0.7152 * buf[i * 3 + 1] + 0.0722 * buf[i * 3 + 2]
  const edge = new Uint8Array(width * height)
  for (const buf of [a, b]) {
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const i = y * width + x
        if (Math.abs(luma(buf, i) - luma(buf, i + 1)) > 24 || Math.abs(luma(buf, i) - luma(buf, i + width)) > 24) edge[i] = 1
      }
    }
  }
  const near = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!edge[y * width + x]) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const yy = y + dy
          const xx = x + dx
          if (yy >= 0 && yy < height && xx >= 0 && xx < width) near[yy * width + xx] = 1
        }
      }
    }
  }
  let total = 0
  let worst = 0
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i * 3 + c] - b[i * 3 + c])
      total += d
      if (!near[i] && d > worst) worst = d
    }
  }
  return { mean: total / (width * height * 3), worstOutsideEdges: worst }
}

export async function integratedLoudness(path: string): Promise<number> {
  const { stderr } = await runFfmpeg(['-nostats', '-i', path, '-vn', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'])
  const match = /Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(stderr)
  if (!match) throw new Error(`No loudness reading for ${path}`)
  return Number(match[1])
}

export async function silences(path: string): Promise<{ start: number; end: number }[]> {
  const { stderr } = await runFfmpeg(['-nostats', '-i', path, '-vn', '-af', 'silencedetect=n=-45dB:d=0.25', '-f', 'null', '-'])
  const starts = [...stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]))
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
  return starts.map((start, i) => ({ start, end: ends[i] ?? Infinity }))
}
