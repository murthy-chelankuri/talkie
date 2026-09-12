import { closeSync, openSync, readFileSync, readSync } from 'fs'

/** What the header says about a take: enough to time it and to judge it. */
export interface WavFormat {
  sampleRate: number
  channels: number
  bitsPerSample: number
  seconds: number
}

function findDataChunkOffset(buffer: Buffer): number {
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    if (chunkId === 'data') return offset
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  throw new Error('WAV file has no data chunk')
}

/**
 * Everything here lives in the header, so only the header is read.
 *
 * These files are read repeatedly — to time a take, to lay out a waveform, to cut captions — and
 * a narration wav is megabytes of samples that none of those questions need. A few kilobytes
 * covers the chunk table of anything the app writes; a file with something unusual ahead of the
 * samples falls back to reading the whole thing rather than failing.
 */
function readHeader(filePath: string): Buffer {
  const fd = openSync(filePath, 'r')
  try {
    const head = Buffer.alloc(4096)
    const read = readSync(fd, head, 0, head.length, 0)
    const buffer = head.subarray(0, read)
    findDataChunkOffset(buffer)
    return buffer
  } catch {
    return readFileSync(filePath)
  } finally {
    closeSync(fd)
  }
}

export function readWavFormat(filePath: string): WavFormat {
  const buffer = readHeader(filePath)
  const sampleRate = buffer.readUInt32LE(24)
  const channels = buffer.readUInt16LE(22)
  const bitsPerSample = buffer.readUInt16LE(34)
  const dataChunkOffset = findDataChunkOffset(buffer)
  const dataSize = buffer.readUInt32LE(dataChunkOffset + 4)
  const bytesPerSample = bitsPerSample / 8
  const totalSamples = dataSize / (bytesPerSample * channels)

  return { sampleRate, channels, bitsPerSample, seconds: totalSamples / sampleRate }
}

export function getWavDurationSeconds(filePath: string): number {
  return readWavFormat(filePath).seconds
}
