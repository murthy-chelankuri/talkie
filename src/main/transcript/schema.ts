import { z } from 'zod'

/**
 * Marks a take the user recorded themselves rather than one a voice read out. Changing the
 * synthesised voice must never make a real recording look out of date.
 */
export const RECORDED_VOICE = 'your own voice'

export const TranscriptSegmentSchema = z.object({
  id: z.string(),
  text: z.string(),
  timelineItemId: z.string(),
  audioFile: z.string().optional(),
  // Which voice read this take. Absent on narration recorded before the voice was choosable.
  voice: z.string().optional(),
  status: z.enum(['draft', 'edited', 'narrated'])
})

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>
