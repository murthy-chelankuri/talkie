import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg } from '../media'

/**
 * Takes for the tests, made the way a person at a desk would make one.
 *
 * A plain tone has no pauses and no room, so it says nothing about a clean-up; a voice with a fan
 * and mains hum under it, and a second of the room before the first word, does. The "voice" was
 * once the macOS `say` voice, dropped with the rest of it (see schema.ts). In its place is a
 * band-limited noise burst train — speech-band energy with real gaps between the words — which
 * is not words but is exactly what the clean-up ever measured: a loud band standing over a quiet
 * room with pauses in it. It needs nothing installed and reads the same on any machine.
 */

/** Where the room is heard alone, and where the voice is, in seconds of a take from `roomyTake`. */
export const ROOM_ALONE = { start: 0.1, end: 0.9 }
export const VOICE_SPOKEN = { start: 1.5, end: 4 }

/**
 * A voice-like signal over room noise, written to `path` — opus in webm, as the browser hands a
 * take over, or WAV for Chromium's fake microphone to play. `noise` is the fan's amplitude, 0.005
 * a quiet room and 0.12 a loud one. The voice is a second in, so the first second is room alone.
 */
export async function writeRoomyTake(path: string, noise = 0.04): Promise<void> {
  const codec = path.endsWith('.wav') ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libopus', '-b:a', '64k']
  await runFfmpeg([
    // The voice: three seconds of white noise, band-limited to the speech range, gated into
    // 0.4s bursts with 0.2s gaps — words and the pauses between them.
    '-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=0.5:sample_rate=48000:d=3',
    '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=${noise}:sample_rate=48000`,
    '-f', 'lavfi', '-i', 'sine=f=60:sample_rate=48000',
    '-filter_complex',
    `[0]highpass=f=250,lowpass=f=3400,volume='if(lt(mod(t,0.6),0.4),1,0)':eval=frame,adelay=1000,apad=pad_dur=1[v];` +
      `[2]volume=${noise}[hum];[v][1][hum]amix=inputs=3:duration=first:normalize=0`,
    '-ac', '1', '-ar', '48000', ...codec, '-y', path
  ])
}

/** The same take as the browser's bytes. */
export async function roomyTake(noise = 0.04): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-roomy-take-'))
  try {
    const path = join(dir, 'take.webm')
    await writeRoomyTake(path, noise)
    return new Uint8Array(readFileSync(path))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The RMS level of a stretch of a file, in dBFS. */
export async function levelBetween(path: string, span: { start: number; end: number }): Promise<number> {
  const result = await runFfmpeg(['-i', path, '-af', `atrim=${span.start}:${span.end},astats=metadata=0`, '-f', 'null', '-'])
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  return Number(output.match(/RMS level dB:\s*(-?[\d.]+|-inf)/)?.[1] ?? NaN)
}

/** How far the voice stands above the room, in dB. */
export async function voiceOverRoom(path: string): Promise<number> {
  const room = await levelBetween(path, ROOM_ALONE)
  return (await levelBetween(path, VOICE_SPOKEN)) - (Number.isFinite(room) ? room : -120)
}
