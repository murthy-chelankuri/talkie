import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { forgetVoicePauseSupport, voiceHonoursPauses } from './voicePauseSupport'

/**
 * Against stand-in `say`/`afconvert`, not the real tools — the real calibration measures actual
 * synthesis time, which is exactly the thing a fast, deterministic test cannot depend on. The
 * fakes are Node scripts rather than shell, because they need to parse the markup and write a
 * real WAV header of a chosen length, which `printf`/`echo` cannot do.
 *
 * A voice whose name starts with "Honours" adds up every `[[slnc N]]` in the text it is asked to
 * speak and comes out that much longer; any other name comes out half a second *shorter* than the
 * plain version regardless of markup — standing in for the real failure this exists to catch,
 * where embedded commands did not just get ignored but actively cost time.
 */
let binDir: string
const originalPath = process.env.PATH

function installFakes(): void {
  // An absolute interpreter path rather than `#!/usr/bin/env node`: the test overrides PATH down
  // to just this directory, and `env` cannot then find `node` to hand off to either.
  const sayPath = join(binDir, 'say')
  writeFileSync(
    sayPath,
    `#!${process.execPath}
const { writeFileSync, appendFileSync } = require('fs')
const path = require('path')
appendFileSync(path.join(__dirname, 'say.calls'), '1\\n')
const args = process.argv.slice(2)
const voice = args[args.indexOf('-v') + 1]
const outPath = args[args.indexOf('-o') + 1]
const text = args[args.length - 1]
const BASE = 2
let duration = BASE
if (voice.startsWith('Honours')) {
  const matches = [...text.matchAll(/\\[\\[slnc (\\d+)\\]\\]/g)]
  duration += matches.reduce((sum, m) => sum + Number(m[1]), 0) / 1000
} else {
  duration -= 0.5
}
writeFileSync(outPath, String(duration))
`
  )
  chmodSync(sayPath, 0o755)

  const afconvertPath = join(binDir, 'afconvert')
  writeFileSync(
    afconvertPath,
    `#!${process.execPath}
const { readFileSync, writeFileSync } = require('fs')
const args = process.argv.slice(2)
const inPath = args[args.length - 2]
const outPath = args[args.length - 1]
const duration = Number(readFileSync(inPath, 'utf8'))
const sampleRate = 8000
const bytesPerSample = 2
const dataBytes = Math.round(duration * sampleRate) * bytesPerSample
const data = Buffer.alloc(dataBytes)
const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + dataBytes, 4)
header.write('WAVEfmt ', 8)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(1, 22)
header.writeUInt32LE(sampleRate, 24)
header.writeUInt32LE(sampleRate * bytesPerSample, 28)
header.writeUInt16LE(bytesPerSample, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(dataBytes, 40)
writeFileSync(outPath, Buffer.concat([header, data]))
`
  )
  chmodSync(afconvertPath, 0o755)
}

function countSayCalls(): number {
  // The fake overwrites its output each call; instead each call is recorded by appending to a
  // log the fake writes to, named after this file's own directory so tests cannot collide.
  const path = join(binDir, 'say.calls')
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).length : 0
}

describe('deciding whether a voice honours embedded pause commands', () => {
  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), 'talkie-voice-support-'))
    process.env.PATH = binDir
    installFakes()
    forgetVoicePauseSupport()
  })

  afterEach(() => {
    process.env.PATH = originalPath
    rmSync(binDir, { recursive: true, force: true })
    forgetVoicePauseSupport()
  })

  it('says yes for a voice that comes out longer once pauses are embedded', async () => {
    expect(await voiceHonoursPauses('HonoursItsCommands')).toBe(true)
  })

  it('says no for a voice that comes out shorter despite the pauses asked for', async () => {
    // This is the shape of the real bug: not merely unaffected by the markup, but shorter for it.
    expect(await voiceHonoursPauses('IgnoresItsCommands')).toBe(false)
  })

  it('remembers the answer rather than asking the voice again', async () => {
    await voiceHonoursPauses('HonoursCaching')
    const afterFirst = countSayCalls()
    await voiceHonoursPauses('HonoursCaching')

    expect(countSayCalls()).toBe(afterFirst)
    expect(afterFirst).toBeGreaterThan(0)
  })

  it('asks again after being told to forget', async () => {
    await voiceHonoursPauses('HonoursForgetting')
    const afterFirst = countSayCalls()
    forgetVoicePauseSupport('HonoursForgetting')
    await voiceHonoursPauses('HonoursForgetting')

    expect(countSayCalls()).toBeGreaterThan(afterFirst)
  })
})
