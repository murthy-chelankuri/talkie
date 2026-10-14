import { renameSync, rmSync } from 'fs'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { assembleTake } from './assembleTake'
import { placeBeats } from './narrationBeats'
import { AIM_INSIDE, MAX_SPEED_UP, hurriedBy, roomFor } from './fitToFootage'
import { arcFor } from '../tts/prosody'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../composition/constants'
import type { SpeechOptions } from '../tts/ttsProvider'
import type { NarrationBeat } from './schema'

/**
 * How many goes at catching up. The same two as a plain take, and for the same reason: a voice
 * treats a rate as a hint, so each attempt is measured and the next corrects from what came back.
 */
const MAX_ATTEMPTS = 2

export interface TimedTakeRequest {
  beats: NarrationBeat[]
  /** Where the finished take is written. */
  audioPath: string
  /** How much footage the scene has, or null for a slide, which is as long as it needs to be. */
  footageFrames: number | null
  delivery: SpeechOptions
  synthesize: (text: string, outputPath: string, options: SpeechOptions) => Promise<void>
}

/**
 * Read a take a beat at a time, and if it comes out behind the picture, read it again to catch up.
 *
 * Each beat is spoken separately and the waits between them are real silence, so the voice waits
 * when the screen does. What that cannot do on its own is make the take shorter: `placeBeats`
 * shortens the waiting when the timings overrun, but the words take as long as they take, and a
 * take whose words alone outlast the scene used to be left running over a picture that had
 * already moved on.
 *
 * So a take that lands late is read again slightly faster — the whole take, not the tail, because
 * hurrying only the end is audible and hurrying all of it is not. This is the only thing in the
 * chain that can recover time without cutting anything, and it is why a scene is short: a tenth
 * faster buys about a second and a half back over fifteen seconds, which is enough to absorb a
 * drift but nowhere near enough to absorb a whole session's worth.
 *
 * Returns how long the take runs. Where no delivery this side of gabbling would fit, the best
 * attempt is kept and the scene's own cut moves later instead — see fitClipToNarration.
 */
export async function readTimedTake(request: TimedTakeRequest): Promise<number> {
  const { beats, audioPath, footageFrames, delivery } = request
  const room = footageFrames === null ? Infinity : roomFor(footageFrames)

  const attemptPath = `${audioPath}.try.wav`
  let speedUp = 1
  let best = Infinity

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const seconds = await layOne(request, hurriedBy(delivery, speedUp), attemptPath)

      // Keep the shortest that has been managed, so a second go that came back longer — which a
      // voice asked for an impossible rate will do — cannot leave the segment worse off.
      if (seconds < best) {
        best = seconds
        renameSync(attemptPath, audioPath)
      }
      if (best <= room) return best

      const next = speedUp * (best / (room * AIM_INSIDE))
      // Past this the voice stops sounding like someone explaining and starts sounding like a
      // disclaimer, which is worse than the drift it would fix.
      if (next > MAX_SPEED_UP || next <= speedUp) return best
      speedUp = next
    }

    return best
  } finally {
    rmSync(attemptPath, { force: true })
  }
}

/** One go: read every beat, place them against the footage, and join them with real silence. */
async function layOne(
  request: TimedTakeRequest,
  delivery: SpeechOptions,
  outputPath: string
): Promise<number> {
  const { beats, audioPath, footageFrames } = request
  const pieces: { at: number; wavPath: string }[] = []
  const spoken: number[] = []

  try {
    for (const [index, beat] of beats.entries()) {
      const beatPath = `${audioPath}.beat${index}.wav`
      // Its own slice of the take's pitch fall. Each beat is a separate call to the voice, so
      // without this they all start from the baseline and the take has no shape. See prosody.ts.
      await request.synthesize(beat.text, beatPath, { ...delivery, arc: arcFor(index, beats.length) })
      spoken.push(getWavDurationSeconds(beatPath))
      pieces.push({ at: beat.at, wavPath: beatPath })
    }

    const words = spoken.reduce((total, seconds) => total + seconds, 0)
    const at = placeBeats(beats, spoken, {
      leadInSeconds: NARRATION_LEAD_IN_FRAMES / FPS,
      // The last moment speech may end, on the scene's own clock. A slide has no picture to keep
      // up with and grows to whatever the words need, so its beats keep their timings untouched.
      // Against footage, never squeeze past the words themselves: that would only stack beats on
      // top of one another, and being late is the thing being fixed.
      roomSeconds:
        footageFrames === null
          ? Infinity
          : Math.max((footageFrames - NARRATION_TAIL_FRAMES) / FPS, words)
    })

    // The take's own clock starts where the composition drops it in, so the lead-in the scene
    // already leaves is not counted twice.
    const offset = NARRATION_LEAD_IN_FRAMES / FPS
    return assembleTake(
      pieces.map((piece, index) => ({ ...piece, at: Math.max(0, at[index] - offset) })),
      outputPath
    ).seconds
  } finally {
    for (const piece of pieces) rmSync(piece.wavPath, { force: true })
  }
}
