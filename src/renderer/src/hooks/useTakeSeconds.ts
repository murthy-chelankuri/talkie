import { useEffect, useState } from 'react'

/**
 * How long a voiced take runs, read off the audio's own header.
 *
 * Only the metadata is fetched — the length is all the script needs, and decoding a take to
 * learn it would cost the waveform's work for every scene on the page.
 */
export function useTakeSeconds(url: string | undefined): number | null {
  const [seconds, setSeconds] = useState<number | null>(null)

  useEffect(() => {
    setSeconds(null)
    if (!url) return
    const audio = new Audio()
    audio.preload = 'metadata'
    const read = (): void => {
      if (Number.isFinite(audio.duration)) setSeconds(audio.duration)
    }
    audio.addEventListener('loadedmetadata', read)
    audio.src = url
    return () => {
      audio.removeEventListener('loadedmetadata', read)
      audio.removeAttribute('src')
    }
  }, [url])

  return seconds
}
