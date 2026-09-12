import { useEffect, useState } from 'react'

/**
 * The shape of a narration take, for drawing on the timeline.
 *
 * Read from the audio itself rather than stored alongside it: every take already on disk gets a
 * waveform without being re-recorded, and there is no second file to keep in step with the
 * first. Decoding is the cost, so it happens once per take and is remembered — the URL carries a
 * version, so re-recording a clip asks a different question and gets a different answer.
 */
export interface Waveform {
  peaks: number[]
  /** How long the take runs, so it can be drawn against the clip rather than stretched over it. */
  seconds: number
}

const cache = new Map<string, Waveform>()
const inFlight = new Map<string, Promise<Waveform | null>>()

/** How many bars a take is reduced to. Stretched to whatever width the clip has. */
export const WAVEFORM_BUCKETS = 56

let context: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (context) return context
  try {
    context = new AudioContext()
    return context
  } catch {
    // No Web Audio here — the label alone still says whose voice it is.
    return null
  }
}

/**
 * Peak amplitude per bucket, normalised so a quiet take is still legible.
 *
 * Peaks rather than averages: an average of a speech waveform is close to silence everywhere,
 * which draws a flat line and says nothing about where the words are.
 */
export function peaksFrom(samples: Float32Array, buckets: number): number[] {
  const size = Math.floor(samples.length / buckets) || 1
  const peaks: number[] = []

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = bucket * size
    let peak = 0
    for (let i = start; i < start + size && i < samples.length; i += 1) {
      const value = Math.abs(samples[i])
      if (value > peak) peak = value
    }
    peaks.push(peak)
  }

  const loudest = Math.max(...peaks)
  return loudest > 0 ? peaks.map((peak) => peak / loudest) : peaks
}

export async function loadWaveform(url: string, buckets = WAVEFORM_BUCKETS): Promise<Waveform | null> {
  const cached = cache.get(url)
  if (cached) return cached

  const pending = inFlight.get(url)
  if (pending) return pending

  const work = (async (): Promise<Waveform | null> => {
    try {
      const ctx = audioContext()
      if (!ctx) return null

      const response = await fetch(url)
      if (!response.ok) return null

      const decoded = await ctx.decodeAudioData(await response.arrayBuffer())
      const waveform: Waveform = {
        peaks: peaksFrom(decoded.getChannelData(0), buckets),
        seconds: decoded.duration
      }
      cache.set(url, waveform)
      return waveform
    } catch {
      // A take that cannot be decoded simply has no picture; it still plays, and the layer still
      // names its voice.
      return null
    } finally {
      inFlight.delete(url)
    }
  })()

  inFlight.set(url, work)
  return work
}

/** The waveform for a take, once it has been read. Null until then, and null if it cannot be. */
export function useWaveform(url: string | undefined, enabled: boolean): Waveform | null {
  const [waveform, setWaveform] = useState<Waveform | null>(() =>
    url ? (cache.get(url) ?? null) : null
  )

  useEffect(() => {
    if (!url || !enabled) {
      setWaveform(null)
      return
    }

    const ready = cache.get(url)
    if (ready) {
      setWaveform(ready)
      return
    }

    let current = true
    void loadWaveform(url).then((result) => {
      if (current) setWaveform(result)
    })
    return () => {
      current = false
    }
  }, [url, enabled])

  return waveform
}
