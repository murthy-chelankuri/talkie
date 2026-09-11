import { z } from 'zod'

export const CURRENT_SCHEMA_VERSION = 1

export const ProjectMetadataSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string(),
  schemaVersion: z.number().int()
})

export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>

export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
}

// What the project browser needs to show a project without opening it.
export interface ProjectOverview extends ProjectSummary {
  clipCount: number
  durationFrames: number
  narratedCount: number
  // Absolute path to the first clip's media, resolved to a served URL before it reaches the
  // renderer. Absent for a project with no clips yet.
  posterPath?: string
  posterKind?: string
  posterTrimBefore?: number
}
