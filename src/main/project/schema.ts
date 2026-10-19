import { z } from 'zod'
import { ProjectContextSchema } from './projectContext'

/**
 * 2: a clip's media is named relative to its project's folder (timelineFile.ts). Raised so a
 * Talkie from before that says "update the app" rather than playing clips it cannot find.
 */
export const CURRENT_SCHEMA_VERSION = 2

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
  context: ProjectContextSchema.optional(),
  /**
   * The theme this project's video follows, from the library in the Studio's Themes folder. Absent means the
   * look every project had before themes existed. See src/main/themes.
   */
  themeId: z.string().optional(),
  /**
   * Whether the opening and closing cards were added, which happens the first time a project
   * gets a theme and never again — a later change of theme restyles them rather than adding more.
   */
  bookendsAdded: z.boolean().optional(),
  /** Which shipped example this project was installed from, if it was. See installExamples.ts. */
  example: z.string().optional()
})

export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>

export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
  /** Set when the project is one of the examples Talkie ships with. */
  example?: string
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
