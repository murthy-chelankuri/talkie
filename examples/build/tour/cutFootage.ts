import { execFileSync } from 'child_process'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { dirname, join } from 'path'
import { writeActionLog } from '../../../src/main/capture/actionLog'
import { HEIGHT, WIDTH, type Filmed, type Shot } from './film'

/** The ffmpeg and ffprobe the export itself uses, so the build needs nothing else installed. */
const BINARIES = dirname(require.resolve('@remotion/compositor-darwin-arm64/package.json'))
const ENV = { ...process.env, DYLD_LIBRARY_PATH: BINARIES }

export function lengthMs(video: string): number {
  const out = execFileSync(
    join(BINARIES, 'ffprobe'),
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', video],
    { env: ENV }
  ).toString()
  return Math.round(Number(out.trim()) * 1000)
}

/**
 * A small window, cut out of the corner it was recorded in and centred on a frame of its own.
 *
 * The ffmpeg Remotion ships can crop and scale but has no `pad` or `overlay`, and a clip is drawn
 * to cover the frame, so a toolbar left at its own shape would lose its top and bottom. Its
 * frames are laid onto the backdrop one by one instead — a few seconds of a small window.
 */
async function framedClip(source: string, fromMs: number, ms: number, area: { width: number; height: number }, out: string): Promise<void> {
  const frames = join(dirname(out), 'frames')
  rmSync(frames, { recursive: true, force: true })
  mkdirSync(frames)
  const scale = Math.min(WIDTH / area.width, HEIGHT / area.height)
  const [width, height] = [Math.round((area.width * scale) / 2) * 2, Math.round((area.height * scale) / 2) * 2]
  execFileSync(
    join(BINARIES, 'ffmpeg'),
    ['-v', 'error', '-y', '-ss', (fromMs / 1000).toFixed(3), '-i', source, '-t', (ms / 1000).toFixed(3),
      '-vf', `crop=${area.width}:${area.height}:0:0,scale=${width}:${height}`, '-r', '30', join(frames, '%05d.png')],
    { env: ENV }
  )
  const canvas = createCanvas(WIDTH, HEIGHT)
  const context = canvas.getContext('2d')
  for (const name of readdirSync(frames).sort()) {
    context.fillStyle = BACKDROP
    context.fillRect(0, 0, WIDTH, HEIGHT)
    context.drawImage(await loadImage(join(frames, name)), (WIDTH - width) / 2, (HEIGHT - height) / 2)
    writeFileSync(join(frames, name), canvas.toBuffer('image/png'))
  }
  execFileSync(
    join(BINARIES, 'ffmpeg'),
    ['-v', 'error', '-y', '-framerate', '30', '-i', join(frames, '%05d.png'), ...ENCODE, out],
    { env: ENV }
  )
  rmSync(frames, { recursive: true, force: true })
}

/** H.264 at the composition's own 30 fps, as every recording Talkie imports ends up. */
const ENCODE = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart']

/** Where a click lands once its window has been framed: shares of the whole picture again. */
function placed(
  click: { x: number; y: number; w: number; h: number },
  area: { width: number; height: number } | undefined
): { x: number; y: number; w: number; h: number } {
  if (!area) return { x: click.x, y: click.y, w: click.w, h: click.h }
  const scale = Math.min(WIDTH / area.width, HEIGHT / area.height)
  const [shownWidth, shownHeight] = [area.width * scale, area.height * scale]
  const [left, top] = [(WIDTH - shownWidth) / 2, (HEIGHT - shownHeight) / 2]
  return {
    x: (left + click.x * shownWidth) / WIDTH,
    y: (top + click.y * shownHeight) / HEIGHT,
    w: (click.w * shownWidth) / WIDTH,
    h: (click.h * shownHeight) / HEIGHT
  }
}

/** Talkie's own dark background, so a framed window sits in the app's colours. */
const BACKDROP = '#0d0f14'

export type Cut = { name: string; path: string; seconds: number }

/**
 * One clip per shot, each in a folder of its own with the clicks that happened in it.
 *
 * A folder each rather than one long recording cut by trims: a scene whose narration runs longer
 * than its footage borrows from the next scene of the same file, and here what lies between two
 * shots is the waiting that was cut out — a draft being written, a video exporting. Apart, a long
 * line simply holds the shot's last frame.
 *
 * The clicks go beside each clip as `actions.jsonl`, on the clip's own clock, which is where a
 * recording keeps them and how the picture knows where to lean in.
 */
export async function cutFootage(filmed: Filmed, outDir: string): Promise<Cut[]> {
  // The page clock starts a moment after its video does. The video ends when the app closes, so
  // the difference between the two lengths is how far every noted time has to move.
  const lead: Partial<Record<Shot['window'], number>> = {}
  for (const [window, video] of Object.entries(filmed.videos)) {
    lead[window as Shot['window']] = Math.max(0, lengthMs(video!.path) - video!.pageMs)
  }

  const cuts: Cut[] = []
  for (const [index, shot] of filmed.shots.entries()) {
    const video = filmed.videos[shot.window]
    if (!video) throw new Error(`No video was kept of the ${shot.window} window for "${shot.name}"`)
    const from = shot.from + (lead[shot.window] ?? 0)
    const ms = shot.to - shot.from
    process.stderr.write(`cutting: ${shot.name}\n`)
    const dir = join(outDir, `${String(index + 1).padStart(2, '0')}-${shot.name}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'clip.mp4')
    if (shot.area) {
      await framedClip(video.path, from, ms, shot.area, path)
    } else {
      execFileSync(
        join(BINARIES, 'ffmpeg'),
        [
          '-v', 'error', '-y',
          '-ss', (from / 1000).toFixed(3),
          '-i', video.path,
          '-t', (ms / 1000).toFixed(3),
          // Constant 30 fps; Playwright writes frames only as the page changes, and a variable
          // rate seeks badly.
          '-r', '30',
          ...ENCODE,
          path
        ],
        { env: ENV }
      )
    }
    writeActionLog(
      join(dir, 'actions.jsonl'),
      shot.clicks.map((click) => ({ t: click.t - shot.from, type: 'click' as const, ...placed(click, shot.area) }))
    )
    cuts.push({ name: shot.name, path, seconds: ms / 1000 })
  }
  return cuts
}
