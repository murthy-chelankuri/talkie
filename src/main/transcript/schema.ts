import { z } from 'zod'

/**
 * Marks a take the user recorded themselves rather than one a voice read out. Changing the
 * synthesised voice must never make a real recording look out of date.
 */
export const RECORDED_VOICE = 'your own voice'

/**
 * One thing said at one moment of the clip.
 *
 * Narration is written against a recording whose events are not evenly spread, so a take is a
 * sequence of these rather than one block of prose read straight through. `at` is seconds from
 * the start of the clip — see narrationBeats.ts for how they are placed and assembleTake.ts for
 * how the silence between them is made.
 */
export const NarrationBeatSchema = z.object({
  at: z.number().min(0),
  text: z.string()
})

/**
 * A take in the user's own voice, as the microphone heard it.
 *
 * Kept beside the take itself so cleaning it up can be switched off, or on, after the fact: the
 * clean-up is a guess about the room, and a guess that took a word's tail with the noise has to be
 * undoable by more than recording the line again.
 */
export const RecordedTakeSchema = z.object({
  /** The recording before any clean-up or levelling, in the project's audio folder. */
  original: z.string(),
  /** Whether the take now in `audioFile` was cleaned up. */
  cleaned: z.boolean()
})

export const TranscriptSegmentSchema = z.object({
  id: z.string(),
  /** The whole narration as prose, which is what is shown and edited. */
  text: z.string(),
  /**
   * The same words, cut into moments. Absent on narration written before it was timed, and on
   * anything a user has edited by hand since — in both cases the take is read as one beat.
   */
  beats: z.array(NarrationBeatSchema).optional(),
  timelineItemId: z.string(),
  audioFile: z.string().optional(),
  // Which voice read this take. Absent on narration recorded before the voice was choosable.
  voice: z.string().optional(),
  /** Only on a take recorded in the user's own voice, and only one recorded since this was kept. */
  recording: RecordedTakeSchema.optional(),
  status: z.enum(['draft', 'edited', 'narrated'])
})

export type RecordedTake = z.infer<typeof RecordedTakeSchema>
export type NarrationBeat = z.infer<typeof NarrationBeatSchema>
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>
