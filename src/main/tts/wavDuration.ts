import { readFileSync } from 'fs'

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

export function getWavDurationSeconds(filePath: string): number {
  const buffer = readFileSync(filePath)
  const sampleRate = buffer.readUInt32LE(24)
  const numChannels = buffer.readUInt16LE(22)
  const bitsPerSample = buffer.readUInt16LE(34)
  const dataChunkOffset = findDataChunkOffset(buffer)
  const dataSize = buffer.readUInt32LE(dataChunkOffset + 4)
  const bytesPerSample = bitsPerSample / 8
  const totalSamples = dataSize / (bytesPerSample * numChannels)
  return totalSamples / sampleRate
}
