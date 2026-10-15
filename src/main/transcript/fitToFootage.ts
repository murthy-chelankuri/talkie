import { existsSync, renameSync, rmSync } from 'fs'
import { probeMedia } from '../media'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../composition/constants'
import type { SpeechOptions } from '../tts/ttsProvider'
import type { TimelineItem } from '../project/timeline/schema'

/**
 * The most a take may be hurried to fit its clip.
 *
 * Beyond about this much the voice stops sounding like someone explaining and starts sounding
 * like a disclaimer, which is worse than the problem being solved. A take needing more than this
 * is too long for its clip by an amount no delivery can hide, so the clip is stretched as before
 * and at least nothing is cut off mid-word.
 *
 * This caps what is asked for, not what comes back: a voice treats a rate as a hint and may
 * deliver a little either side of it. Landing early is harmless — the clip simply ends on its own
 * footage in silence — and every voice measured here erred that way rather than the other.
 */
export const MAX_SPEED_UP = 1.15

/**
 * How many goes at hitting the length.
 *
 * `say` takes a rate in words a minute and treats it as a hint: measured on this machine, asking
 * Samantha for six per cent faster returned a take half a per cent shorter, while eleven per cent
 * gave nine. The response is close enough to linear to aim with and far enough off to need
 * checking, so each attempt is measured and the next one corrects from what actually came back.
 */
const MAX_ATTEMPTS = 2

/**
 * Aim a little inside the clip rather than exactly at its end.
 *
 * A take that lands a beat early is unremarkable; one that lands a beat late is the whole of the
 * problem. Aiming short also converges faster against a voice that under-delivers the rate it is
 * asked for, which every one measured here does.
 */
export const AIM_INSIDE = 0.97

/** Seconds of a clip the words themselves get, once the beats either side are taken. */
export function roomFor(footageFrames: number): number {
  return (footageFrames - NARRATION_LEAD_IN_FRAMES - NARRATION_TAIL_FRAMES) / FPS
}

/**
 * The same delivery, in a hurry.
 *
 * The written pauses shorten by the same proportion as the words, because a person who is
 * speeding up does not hold their full stops either.
 */
export function hurriedBy(speech: SpeechOptions, speedUp: number): SpeechOptions {
  return {
    ...speech,
    // The settings' own ceiling, so a fast voice and a long take cannot ask for the impossible.
    pace: Math.min(300, speech.pace * speedUp),
    sentencePauseMs: Math.round(speech.sentencePauseMs / speedUp),
    clausePauseMs: Math.round(speech.clausePauseMs / speedUp)
  }
}

/**
 * How many frames of a clip actually have a picture behind them.
 *
 * Only a recording has an answer: a slide or an image is drawn for as long as it is asked to be.
 * Null means there is no footage to fit to, and the narration sets the length as it always did.
 *
 * A scene cut out of a session owns a stretch of the file rather than the whole of it, so the
 * answer is the length of that stretch. Measuring the file would tell every scene but the last
 * that it has minutes to play with, which is exactly the mistake that let narration run on over
 * a picture that had already moved on.
 */
export async function footageFrames(item: TimelineItem | undefined): Promise<number | null> {
  if (!item || item.kind !== 'video') return null

  const { src, trimBefore, trimAfter } = item.data as {
    src?: string
    trimBefore?: number
    trimAfter?: number
  }
  if (!src || !existsSync(src)) return null

  try {
    const { durationSeconds } = await probeMedia(src)
    if (!durationSeconds || durationSeconds <= 0) return null
    const lastFrame = Math.min(Math.round(durationSeconds * FPS), trimAfter ?? Infinity)
    return Math.max(1, lastFrame - (trimBefore ?? 0))
  } catch (err) {
    // A clip we cannot measure is one we cannot fit to; the narration sets the length instead.
    console.error(`Could not measure the footage behind ${src}:`, err)
    return null
  }
}

export interface FitRequest {
  text: string
  /** The take as it was read at the project's own pace. Replaced only by one that fits. */
  audioPath: string
  spokenSeconds: number
  footageFrames: number
  delivery: SpeechOptions
  synthesize: (text: string, outputPath: string, options: SpeechOptions) => Promise<void>
}

/**
 * Read it again, a little faster, so the words land with the picture rather than after it.
 *
 * A recording is as long as it is. Narration written a fifth too long used to stretch the clip
 * past its own last frame: the voice ran on over a picture that had already ended and, because it
 * was ahead of the footage for the whole clip rather than only at the end, described each step
 * before it happened. Speaking is the one part of this that can be adjusted without cutting
 * anything, and a tenth faster is not something a viewer notices.
 *
 * Returns the new length, or null when the take already fitted, when no delivery this side of
 * gabbling would make it, or when the engine cannot be told to go faster at all — in which case
 * the original take is left exactly as it was.
 */
export async function readFaster(request: FitRequest): Promise<number | null> {
  const room = roomFor(request.footageFrames)
  if (room <= 0 || request.spokenSeconds <= room) return null

  const refitPath = `${request.audioPath}.refit.wav`
  let measured = request.spokenSeconds
  let speedUp = 1

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const next = speedUp * (measured / (room * AIM_INSIDE))
      if (next > MAX_SPEED_UP) return null
      speedUp = next

      await request.synthesize(request.text, refitPath, hurriedBy(request.delivery, speedUp))
      const got = getWavDurationSeconds(refitPath)

      // An engine that cannot be told to go faster will not, however often it is asked.
      if (got >= measured) return null
      measured = got

      if (measured <= room) {
        renameSync(refitPath, request.audioPath)
        return measured
      }
    }
    return null
  } catch (err) {
    // A refit that fails must leave the segment with the take it already had, not with none.
    console.error('Could not read the narration back faster to fit its clip:', err)
    return null
  } finally {
    rmSync(refitPath, { force: true })
  }
}
