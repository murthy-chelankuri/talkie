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

/**
 * A slide written in Talkie rather than imported: a heading and some lines under it. Kept as
 * text rather than a picture so it stays editable, searchable and re-styleable later.
 */
/**
 * How a scene looks. Chosen from a set rather than left open: a slide with any font and any
 * colour on it is a slide that can be made to look like nothing else in the video, and these
 * cover what anyone actually reaches for.
 */
export const SceneStyleSchema = z.object({
  theme: z.enum(['graphite', 'ink', 'paper', 'brass']).default('graphite'),
  font: z.enum(['serif', 'sans']).default('serif'),
  align: z.enum(['left', 'center']).default('left'),
  size: z.enum(['regular', 'large']).default('regular'),
  /** The one free colour: the rule, the bullets, and anything marked up in the accent. */
  accent: z.string().default('#d3a24c')
})

export const TextSceneDataSchema = z.object({
  /** May contain a little formatting; see richText.ts for what is allowed. */
  title: z.string(),
  bullets: z.array(z.string()).default([]),
  style: SceneStyleSchema.default({})
})

/**
 * A diagram written as mermaid source. The rendered SVG is kept beside it as a file, because
 * mermaid is a large browser library and the export renderer should not have to run it — and
 * because a diagram that renders differently on export than in the preview is worse than none.
 */
export const DiagramSceneDataSchema = z.object({
  source: z.string(),
  style: SceneStyleSchema.default({}),
  /** Path to the rendered SVG. Absent until it has been drawn once. */
  src: z.string().optional(),
  title: z.string().optional()
})

export const TIMELINE_ITEM_DATA_SCHEMAS: Record<string, z.ZodSchema> = {
  image: ImageItemDataSchema,
  video: VideoItemDataSchema,
  scene: TextSceneDataSchema,
  diagram: DiagramSceneDataSchema
}

export type SceneStyle = z.infer<typeof SceneStyleSchema>
export type TextSceneData = z.infer<typeof TextSceneDataSchema>
export type DiagramSceneData = z.infer<typeof DiagramSceneDataSchema>

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
