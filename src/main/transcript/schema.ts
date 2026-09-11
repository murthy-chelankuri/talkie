import { z } from 'zod'

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
