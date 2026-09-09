import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject, addTimelineItem, addTranscriptSegment, readTranscript, readTimeline } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { narrateSegment } from './narrate'

describe('narrateSegment (real say + afconvert)', () => {
  it('synthesizes real audio and extends the linked timeline item to fit', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-narrate-test-'))
    const project = createProject('Narrate Test', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/tmp/a.png' } }, baseDir)
    const segment = addTranscriptSegment(
      project.id,
      { text: 'This narration is definitely longer than one second of audio.', timelineItemId: item.id },
      baseDir
    )

    const result = await narrateSegment(project.id, segment.id, baseDir)

    expect(result.status).toBe('narrated')
    expect(result.audioFile).toBe(`${segment.id}.wav`)

    const dir = findProjectDir(project.id, baseDir) as string
    const audioPath = join(dir, 'audio', result.audioFile as string)
    expect(existsSync(audioPath)).toBe(true)
    expect(statSync(audioPath).size).toBeGreaterThan(1000)

    const updatedItem = readTimeline(project.id, baseDir).find((i) => i.id === item.id)
    expect(updatedItem?.duration).toBeGreaterThan(30)

    const updatedTranscript = readTranscript(project.id, baseDir)
    expect(updatedTranscript[0].status).toBe('narrated')

    rmSync(baseDir, { recursive: true, force: true })
  }, 30_000)
})
