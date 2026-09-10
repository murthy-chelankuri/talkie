import { z } from 'zod'

export const ImageItemDataSchema = z.object({
  src: z.string()
})

export const VideoItemDataSchema = z.object({
  src: z.string(),
  // Frames to skip at the start of the source video, used to drop the blank lead-in a browser
  // recording begins with. Optional so timelines written before this existed still load.
  trimBefore: z.number().int().min(0).optional()
})

export const TIMELINE_ITEM_DATA_SCHEMAS: Record<string, z.ZodSchema> = {
  image: ImageItemDataSchema,
  video: VideoItemDataSchema
}

export const TimelineItemSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    start: z.number().int().min(0),
    duration: z.number().int().min(1),
    data: z.unknown()
  })
  .superRefine((item, ctx) => {
    const dataSchema = TIMELINE_ITEM_DATA_SCHEMAS[item.kind]
    if (!dataSchema) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kind'], message: `Unknown timeline item kind "${item.kind}"` })
      return
    }
    const result = dataSchema.safeParse(item.data)
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['data'],
        message: `Invalid data for kind "${item.kind}": ${result.error.message}`
      })
    }
  })

export type TimelineItem = z.infer<typeof TimelineItemSchema>
