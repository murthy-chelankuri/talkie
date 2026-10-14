import { FPS, NARRATION_LEAD_IN_FRAMES } from '../../../composition/constants'

/**
 * The export's sound, mixed from the timeline rather than recorded off the page: each take
 * placed where the composition plays it and cut where its clip ends.
 * Recordings are silent, so takes are all there is.
 */
export type Take = { path: string; startFrame: number; maxFrames: number }

export function takesFor(timeline: { id: string; start: number; duration: number }[], narration: Map<string, { path: string }>): Take[] {
  return timeline.flatMap((item) => {
    const take = narration.get(item.id)
    const maxFrames = item.duration - NARRATION_LEAD_IN_FRAMES
    return take && maxFrames > 0 ? [{ path: take.path, startFrame: item.start + NARRATION_LEAD_IN_FRAMES, maxFrames }] : []
  })
}

const seconds = (frames: number): string => (frames / FPS).toFixed(4)

const SAMPLE_RATE = 48000
const AAC_FRAME_SAMPLES = 1024

/**
 * The soundtrack's length, rounded up to a whole AAC frame at or past the video. Cut at exactly
 * the video length its last AAC frame stops short of the picture, and the file's sound ends a
 * fraction of a frame before its video. Padded to the boundary, the last frame covers the video.
 */
function soundtrackSeconds(totalFrames: number): string {
  const samples = Math.ceil(((totalFrames / FPS) * SAMPLE_RATE) / AAC_FRAME_SAMPLES) * AAC_FRAME_SAMPLES
  return (samples / SAMPLE_RATE).toFixed(4)
}

export function soundtrackArgs(takes: Take[], totalFrames: number, output: string): string[] {
  const length = ['-t', soundtrackSeconds(totalFrames)]
  const encode = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']
  if (takes.length === 0) {
    return ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', ...length, ...encode, '-y', output]
  }
  const inputs = takes.flatMap((take) => ['-i', take.path])
  const placed = takes.map((take, i) => {
    const delay = Math.round((take.startFrame / FPS) * 1000)
    return `[${i}:a]atrim=end=${seconds(take.maxFrames)},aformat=sample_rates=48000:channel_layouts=stereo,adelay=delays=${delay}:all=1[t${i}]`
  })
  // Summed, not averaged: takes do not overlap, and amix's default would quieten each by the count.
  const mix = `${takes.map((_, i) => `[t${i}]`).join('')}amix=inputs=${takes.length}:normalize=0:dropout_transition=0,apad[out]`
  return ['-v', 'error', ...inputs, '-filter_complex', [...placed, mix].join(';'), '-map', '[out]', ...length, ...encode, '-y', output]
}
