import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  addTimelineItem,
  addTranscriptSegment,
  createProject,
  updateTranscriptSegmentAudio
} from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { narrationFidelityFor } from './narrationFidelity'

/** A second of silence at `rate` — only the header is ever read. */
function wav(path: string, rate: number): void {
  const data = Buffer.alloc(rate * 2)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([head, data]))
}

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function projectWithTake(voice: string, rate: number): { id: string; baseDir: string } {
  const baseDir = mkdtempSync(join(tmpdir(), 'talkie-fidelity-'))
  dirs.push(baseDir)
  const project = createProject('Fidelity', baseDir)
  const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/tmp/a.png' } }, baseDir)
  const segment = addTranscriptSegment(project.id, { text: 'Hello.', timelineItemId: item.id }, baseDir)
  wav(join(findProjectDir(project.id, baseDir) as string, 'audio', 'take.wav'), rate)
  updateTranscriptSegmentAudio(project.id, segment.id, 'take.wav', voice, baseDir)
  return { id: project.id, baseDir }
}

describe('saying when a voice is holding the sound back', () => {
  it('names a compact macOS voice, which has a better download', () => {
    const { id, baseDir } = projectWithTake('Samantha', 22050)

    expect(narrationFidelityFor(id, baseDir)?.voices).toEqual(['Samantha'])
  })

  it('says nothing about a Kokoro voice, which has no better version to fetch', () => {
    const { id, baseDir } = projectWithTake('af_heart', 24000)

    expect(narrationFidelityFor(id, baseDir)).toBeNull()
  })

  it('says nothing about an OpenAI voice either', () => {
    const { id, baseDir } = projectWithTake('nova', 24000)

    expect(narrationFidelityFor(id, baseDir)).toBeNull()
  })
})
