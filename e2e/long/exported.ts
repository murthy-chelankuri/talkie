import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { takeShape, type TakeShape } from '../audio'
import { ffmpegPath, ffprobePath } from '../../src/main/media'
import { FPS, NARRATION_LEAD_IN_FRAMES } from '../../src/composition/constants'
import { projectsRootDir } from '../../src/main/project/paths'

export type Clip = { id: string; kind: string; start: number; duration: number }

/** A project on disk, found by its name: its folder, clips, and each voiced clip's take. */
export function projectOnDisk(home: string, name: string): { dir: string; clips: Clip[]; takes: Map<string, string> } {
  const root = projectsRootDir(home)
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry)
    if (JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).name !== name) continue
    const timeline = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8'))
    const segments: { timelineItemId: string; audioFile?: string }[] = JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8'))
    return {
      dir,
      clips: Array.isArray(timeline) ? timeline : timeline.items,
      takes: new Map(segments.filter((segment) => segment.audioFile).map((segment) => [segment.timelineItemId, join(dir, 'audio', segment.audioFile!)]))
    }
  }
  throw new Error(`No project called ${name}`)
}

/** The video a project's export wrote, from its renders folder. */
export function exportedVideo(dir: string): string {
  const video = readdirSync(join(dir, 'renders')).find((name) => name.endsWith('.mp4'))
  if (!video) throw new Error(`Nothing exported in ${dir}`)
  return join(dir, 'renders', video)
}

export function videoSeconds(path: string): number {
  return Number(execFileSync(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).toString())
}

/**
 * Each voiced clip as the export plays it, beside its take: the video's own soundtrack from the end
 * of the clip's lead-in for as long as the take lasts (cut at the clip's end, as the export cuts
 * it). Measured off the video, so it is what a viewer hears — a take that was fine on disk and a
 * scene that was silent in the video were once both true, and only this tells them apart. Only as
 * long as the take, because a recording plays on in silence after its words, as it should.
 */
export function voicedClipsInExport(video: string, clips: Clip[], takes: Map<string, string>): { clip: Clip; heard: TakeShape; take: TakeShape }[] {
  const scratch = mkdtempSync(join(tmpdir(), 'talkie-e2e-sound-'))
  try {
    const whole = join(scratch, 'soundtrack.wav')
    execFileSync(ffmpegPath(), ['-v', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-c:a', 'pcm_s16le', whole])
    return clips
      .filter((clip) => takes.has(clip.id))
      .map((clip) => {
        const take = takeShape(takes.get(clip.id)!)
        const part = join(scratch, `${clip.id}.wav`)
        const from = (clip.start + NARRATION_LEAD_IN_FRAMES) / FPS
        const seconds = Math.min(take.seconds, (clip.duration - NARRATION_LEAD_IN_FRAMES) / FPS)
        execFileSync(ffmpegPath(), ['-v', 'error', '-y', '-i', whole, '-ss', from.toFixed(3), '-t', seconds.toFixed(3), part])
        return { clip, heard: takeShape(part), take }
      })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
