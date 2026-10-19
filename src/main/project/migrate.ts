import { ProjectMetadataSchema, CURRENT_SCHEMA_VERSION, type ProjectMetadata } from './schema'

export class UnsupportedSchemaVersionError extends Error {
  constructor(foundVersion: number) {
    super(
      `This project was created by a newer version of Talkie (schema v${foundVersion}, this app supports up to v${CURRENT_SCHEMA_VERSION}). Update the app to open it.`
    )
    this.name = 'UnsupportedSchemaVersionError'
  }
}

type Migration = (metadata: Record<string, unknown>) => Record<string, unknown>

// Keyed by the version a migration upgrades FROM.
const MIGRATIONS: Record<number, Migration> = {
  // Nothing in project.json changes: v2 is about timeline.json, whose paths are made relative as
  // they are read and written (timelineFile.ts) and all at once at startup (repairAssetPaths.ts).
  1: (metadata) => ({ ...metadata, schemaVersion: 2 })
}

export function migrateProjectMetadata(raw: Record<string, unknown>): ProjectMetadata {
  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0
  let data = raw

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(version)
  }

  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version]
    if (!migrate) {
      throw new Error(`No migration registered from schema v${version}`)
    }
    data = migrate(data)
    version += 1
  }

  return ProjectMetadataSchema.parse(data)
}
