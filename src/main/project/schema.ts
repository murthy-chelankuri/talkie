import { z } from 'zod'
import { ProjectContextSchema } from './projectContext'

export const CURRENT_SCHEMA_VERSION = 1

export const ProjectMetadataSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string(),
  schemaVersion: z.number().int(),
  /**
   * The voice this project speaks in.
   *
   * A project's voice belongs to the project, not to the app: changing the voice you prefer for new
   * work should not turn every clip of a finished project into something that needs redoing.
   * Absent means the project follows whatever voice is set in Settings, which is how a new
   * project starts and how every project made before this behaved.
   */
  voice: z.string().optional(),
  /** What the project is about, for everything that writes words for it. See projectContext.ts. */
  context: ProjectContextSchema.optional()
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
