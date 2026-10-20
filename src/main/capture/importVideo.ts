import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { copyFileSync, mkdirSync, rmSync } from 'fs'
import { extname, join } from 'path'
import { findProjectDir } from '../project/paths'
import { h264, probeMedia, runFfmpeg, runFfprobe } from '../media'
import { findFootageCuts } from './footageCuts'
import { planFootageScenes, type SceneWindow } from './sceneBoundaries'
import { appendVideoScenes } from './importRecordedSession'
import { FPS } from '../../composition/constants'
import type { TimelineItem } from '../project/timeline/schema'

/** What the open dialog and the agent tool offer. Anything ffmpeg reads would do; these are what people have. */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']

/**
 * Containers and pictures the editor plays as they are. Anything else is converted to H.264 once,
 * on the way in: Chromium has no ProRes, and a 10-bit or 4:4:4 H.264 it cannot hardware-decode
 * plays as a stutter.
 */
const PLAYS_AS_IS = { containers: ['.mp4', '.mov', '.m4v'], codec: 'h264', pixelFormats: ['yuv420p', 'yuvj420p'] }

/** A video copied into a project and cut into scenes, not yet on the timeline. */
export interface PreparedVideo {
  path: string
  durationFrames: number
  scenes: SceneWindow[]
}

/**
 * Bring a video made somewhere else into a project, as the scenes it is made of.
 *
 * The slow part — copying, converting where it has to, and reading the picture and sound for
 * where to cut — happens here, before anything changes in the project; `appendPreparedVideo` then
 * puts the scenes on the timeline in one go, which is what undo takes back. Its sound is kept in
 * the file but not played: the narration written in Talkie is the soundtrack, as it is for a
 * recording.
 */
export async function prepareVideo(projectId: string, sourcePath: string, baseDir: string = homedir()): Promise<PreparedVideo> {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) throw new Error(`No project found with id ${projectId}`)

  const source = await probeMedia(sourcePath).catch(() => null)
  if (!source?.videoCodec) throw new Error('That file has no video Talkie can read.')

  // Its own folder, as a recording has: the drafter looks beside a clip's file for a log of what
  // happened, and an imported video must not find someone else's.
  const folder = join(dir, 'sources', 'videos', randomUUID())
  mkdirSync(folder, { recursive: true })
  try {
    const path = (await playsAsIs(sourcePath))
      ? copyAs(sourcePath, join(folder, `video${extname(sourcePath).toLowerCase()}`))
      : await convert(sourcePath, join(folder, 'video.mp4'))

    const video = await probeMedia(path)
    if (!video.durationSeconds || video.durationSeconds <= 0) throw new Error('Could not read how long that video is.')
    const durationFrames = Math.max(1, Math.round(video.durationSeconds * FPS))

    const cuts = await findFootageCuts(path, { hasAudio: video.hasAudio, startSeconds: video.startSeconds })
    return { path, durationFrames, scenes: planFootageScenes((durationFrames / FPS) * 1000, cuts) }
  } catch (err) {
    rmSync(folder, { recursive: true, force: true })
    throw err
  }
}

/** The prepared video's scenes, added to the end of the timeline. */
export function appendPreparedVideo(projectId: string, video: PreparedVideo, baseDir: string = homedir()): TimelineItem[] {
  return appendVideoScenes(projectId, { src: video.path, durationFrames: video.durationFrames, trimBefore: 0 }, video.scenes, baseDir)
}

async function playsAsIs(path: string): Promise<boolean> {
  if (!PLAYS_AS_IS.containers.includes(extname(path).toLowerCase())) return false
  const { stdout } = await runFfprobe([
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name,pix_fmt',
    '-of',
    'json',
    path
  ])
  const stream = (JSON.parse(stdout) as { streams?: { codec_name?: string; pix_fmt?: string }[] }).streams?.[0]
  return stream?.codec_name === PLAYS_AS_IS.codec && PLAYS_AS_IS.pixelFormats.includes(stream.pix_fmt ?? '')
}

function copyAs(from: string, to: string): string {
  copyFileSync(from, to)
  return to
}

async function convert(from: string, to: string): Promise<string> {
  await runFfmpeg([
    '-i',
    from,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    ...(await h264('intermediate')),
    // A keyframe a second, as a recording has: every scene starts partway into this file, and the
    // preview seeks there at each cut.
    '-g',
    String(FPS),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    '-y',
    to
  ])
  return to
}
