import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { listShippedExamples, PROJECT_DIR_TOKEN, shippedExamplesDir } from './installExamples'
import { ProjectMetadataSchema } from '../project/schema'
import { TimelineItemSchema } from '../project/timeline/schema'
import { TranscriptSegmentSchema } from '../transcript/schema'

/**
 * The examples as they are committed, read the way the installer and the app will read them.
 * Each is the first thing someone opens, built by a script on another machine; this is where a
 * missing take or a path into the build's temporary folder is found before anyone ships it.
 */
const dir = shippedExamplesDir()
const examples = listShippedExamples(dir)

describe.skipIf(examples.length === 0)('the examples Talkie ships', () => {
  for (const example of examples) {
    describe(example.name, () => {
      const project = join(dir!, example.id, 'project')
      const read = (file: string): unknown => JSON.parse(readFileSync(join(project, file), 'utf-8'))
      const placed = (path: string): string => path.split(PROJECT_DIR_TOKEN).join(project)

      it('is a project the app can open', () => {
        expect(() => ProjectMetadataSchema.parse(read('project.json'))).not.toThrow()
        expect(() => (read('timeline.json') as unknown[]).map((item) => TimelineItemSchema.parse(item))).not.toThrow()
        expect(() => (read('transcript.json') as unknown[]).map((segment) => TranscriptSegmentSchema.parse(segment))).not.toThrow()
      })

      it('names only media it carries', () => {
        const timeline = readFileSync(join(project, 'timeline.json'), 'utf-8')
        const paths = [...timeline.matchAll(/"src":\s*"([^"]+)"/g)].map((match) => match[1])
        expect(paths.length).toBeGreaterThan(0)
        for (const path of paths) {
          expect(path.startsWith(PROJECT_DIR_TOKEN), `${path} is not inside the example`).toBe(true)
          expect(existsSync(placed(path)), `${path} is missing`).toBe(true)
        }
      })

      it('has a take on disk for every clip it says is voiced', () => {
        const narrated = (read('transcript.json') as { status: string; audioFile?: string }[]).filter(
          (segment) => segment.status === 'narrated'
        )
        expect(narrated.length).toBeGreaterThan(0)
        for (const segment of narrated) expect(existsSync(join(project, 'audio', segment.audioFile!))).toBe(true)
      })
    })
  }
})
