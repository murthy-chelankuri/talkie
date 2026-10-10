import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getWavDurationSeconds } from './wavDuration'

function makeTestWavBuffer(sampleRate: number, numSamples: number): Buffer {
  const bitsPerSample = 16
  const numChannels = 1
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = numSamples * blockAlign
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  return buffer
}

describe('getWavDurationSeconds', () => {
  let dir: string

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('computes duration for a 2-second 44.1kHz file', () => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-wav-test-'))
    const filePath = join(dir, 'test.wav')
    writeFileSync(filePath, makeTestWavBuffer(44100, 44100 * 2))

    expect(getWavDurationSeconds(filePath)).toBeCloseTo(2, 5)
  })

  it('computes duration for a 0.5-second 22050Hz file', () => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-wav-test-'))
    const filePath = join(dir, 'test.wav')
    writeFileSync(filePath, makeTestWavBuffer(22050, Math.round(22050 * 0.5)))

    expect(getWavDurationSeconds(filePath)).toBeCloseTo(0.5, 5)
  })

  it('throws a clear error for a file with no data chunk', () => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-wav-test-'))
    const filePath = join(dir, 'bad.wav')
    writeFileSync(filePath, Buffer.from('not a wav file at all'))

    expect(() => getWavDurationSeconds(filePath)).toThrow()
  })
})

describe('a wav that was streamed', () => {
  /** As a streaming server sends it: both lengths left at 0xFFFFFFFF, meaning "until the end". */
  function streamed(sampleRate: number, numSamples: number): Buffer {
    const wav = makeTestWavBuffer(sampleRate, numSamples)
    wav.writeUInt32LE(0xffffffff, 4)
    wav.writeUInt32LE(0xffffffff, 40)
    return wav
  }

  it('is timed by what the file holds, not by the placeholder in its header', () => {
    const dir = mkdtempSync(join(tmpdir(), 'talkie-streamed-wav-'))
    try {
      const path = join(dir, 'take.wav')
      writeFileSync(path, streamed(24000, 48000))

      expect(getWavDurationSeconds(path)).toBeCloseTo(2, 5)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

})
