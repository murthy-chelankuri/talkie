import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { cpSync, existsSync, readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import { projectDirName, projectsRootDir } from '../project/paths'
import { writeJsonAtomic } from '../project/atomicWrite'
import { slugify } from '../project/slug'
import { ProjectMetadataSchema } from '../project/schema'

/**
 * The example projects Talkie ships with, put among the person's own on first launch.
 *
 * Each is an ordinary project — open it, change it, export it — so what someone learns from one
 * is what they would do with their own. They are built by `npm run examples:rebuild` and kept under
 * `examples/projects/<id>/`: `example.json` says what it is, `project/` is the project folder.
 */

/**
 * Stands in for the project's own folder in a shipped example's files.
 *
 * Clips record where their media is as an absolute path, and the folder an example lands in is
 * only known when it is installed. Copying the sample project by hand earlier left every recording
 * pointing at the machine it came from, and export failed with a 404 for each.
 */
export const PROJECT_DIR_TOKEN = '{{TALKIE_PROJECT_DIR}}'

const ExampleManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /**
   * Raised when an example is rebuilt in a way worth a fresh copy. Someone with an older one gets
   * the new one beside it, since theirs may hold their own changes.
   */
  version: z.number().int().positive(),
  /** Lower first. Installed in this order, so the browser shows them in it. */
  order: z.number().int().default(0)
})
export type ExampleManifest = z.infer<typeof ExampleManifestSchema>

const InstallRecordSchema = z.object({
  installed: z.record(z.string(), z.number().int()).default({})
})

/**
 * Where the built examples are: beside the app once packaged, in the checkout otherwise. The
 * checkout is found from this file rather than the working directory, which is `/` for an app
 * opened from Finder.
 */
export function shippedExamplesDir(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    ...(resourcesPath ? [join(resourcesPath, 'examples')] : []),
    // out/main/index.cjs in a build, src/main/examples/ when the sources run under the tests.
    join(__dirname, '..', '..', 'examples', 'projects'),
    join(__dirname, '..', '..', '..', 'examples', 'projects')
  ]
  return candidates.find((dir) => existsSync(dir)) ?? null
}

export function listShippedExamples(sourceDir: string | null = shippedExamplesDir()): ExampleManifest[] {
  if (!sourceDir || !existsSync(sourceDir)) return []
  return readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(sourceDir, entry.name, 'example.json')))
    .map((entry) => ExampleManifestSchema.parse(JSON.parse(readFileSync(join(sourceDir, entry.name, 'example.json'), 'utf-8'))))
    .sort((a, b) => a.order - b.order)
}

/** Which examples have been put in this person's projects already, so a deleted one stays gone. */
function installRecordPath(baseDir: string): string {
  return join(dirname(projectsRootDir(baseDir)), 'examples.json')
}

function readInstallRecord(baseDir: string): z.infer<typeof InstallRecordSchema> {
  try {
    return InstallRecordSchema.parse(JSON.parse(readFileSync(installRecordPath(baseDir), 'utf-8')))
  } catch {
    return { installed: {} }
  }
}

/**
 * Install every shipped example not installed before, or installed at an older version. Run at
 * startup; a deleted example is not brought back, and a new one, or a new version of one, arrives
 * once.
 *
 * Returns the ids of the projects it made.
 */
export function installExamples(baseDir: string = homedir(), sourceDir: string | null = shippedExamplesDir()): string[] {
  const record = readInstallRecord(baseDir)
  const made: string[] = []
  for (const [index, example] of listShippedExamples(sourceDir).entries()) {
    if ((record.installed[example.id] ?? 0) >= example.version) continue
    made.push(installExample(example, sourceDir!, baseDir, index))
    record.installed[example.id] = example.version
    // Written after each, so an example that fails to copy does not take the others with it on
    // the next launch — and one that succeeded is not made twice.
    writeJsonAtomic(installRecordPath(baseDir), record)
  }
  return made
}

/** A fresh copy of every example, beside any already there. For Settings → Reinstall examples. */
export function reinstallExamples(baseDir: string = homedir(), sourceDir: string | null = shippedExamplesDir()): string[] {
  const record = readInstallRecord(baseDir)
  const made = listShippedExamples(sourceDir).map((example, index) => {
    record.installed[example.id] = example.version
    return installExample(example, sourceDir!, baseDir, index)
  })
  writeJsonAtomic(installRecordPath(baseDir), record)
  return made
}

function installExample(example: ExampleManifest, sourceDir: string, baseDir: string, index: number): string {
  const from = join(sourceDir, example.id, 'project')
  const metadata = ProjectMetadataSchema.parse(JSON.parse(readFileSync(join(from, 'project.json'), 'utf-8')))

  // A new id every time, so a reinstall sits beside an edited copy rather than on top of it.
  const id = randomUUID()
  const dir = join(projectsRootDir(baseDir), projectDirName(id, slugify(metadata.name)))
  cpSync(from, dir, { recursive: true })

  const timelinePath = join(dir, 'timeline.json')
  if (existsSync(timelinePath)) {
    const placed = readFileSync(timelinePath, 'utf-8').split(PROJECT_DIR_TOKEN).join(dir)
    writeJsonAtomic(timelinePath, JSON.parse(placed))
  }
  writeJsonAtomic(
    join(dir, 'project.json'),
    ProjectMetadataSchema.parse({
      ...metadata,
      id,
      // Projects are listed newest first, so the first example is made a moment newer than the
      // next: they arrive in the order they are meant to be opened in.
      createdAt: new Date(Date.now() - index * 1000).toISOString(),
      example: example.id
    })
  )
  return id
}
