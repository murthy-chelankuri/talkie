import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useOwnFrame } from './clock'
import { ownHold, reportFailure } from './hold'

let frameReader = ''

/** Which tab this page is, so the asset server keeps one decoder per tab per recording. */
export function setFrameReader(reader: string): void {
  frameReader = reader
}

export function footageFrameUrl(src: string, sourceFrame: number, reader: string): string {
  return `${src}${src.includes('?') ? '&' : '?'}frame=${sourceFrame}&reader=${encodeURIComponent(reader)}`
}

/** A file's own name, for a label — never the URL, which carries the asset server's secret. */
function nameOf(src: string): string {
  try {
    return decodeURIComponent(new URL(src).pathname.split('/').pop() ?? src)
  } catch {
    // Not a URL we can parse; still only the last segment, so a secret in the path stays out of messages.
    return src.split('/').pop() || src
  }
}

/** An image, holding the frame until it has loaded and decoded, and failing the export if it cannot. */
export function OwnPicture({ src, alt, style, label }: { src: string; alt?: string; style?: CSSProperties; label?: string }): JSX.Element {
  const ref = useRef<HTMLImageElement>(null)
  const name = label ?? nameOf(src)
  const [release] = useState(() => ownHold(`Loading ${name}`))

  useEffect(() => {
    const img = ref.current
    if (!img) return
    let finished = false
    const loaded = (): void => {
      if (finished) return
      finished = true
      // Loaded is not drawn: decode() is what makes the next paint show it.
      void Promise.resolve(img.decode?.())
        .catch(() => undefined)
        .finally(release)
    }
    const failed = (): void => {
      reportFailure(`Could not load ${name}`)
      release()
    }
    // Already finished before we listened: a load or an error event will not come again.
    if (img.complete) {
      if (img.naturalWidth > 0) loaded()
      else failed()
    }
    img.addEventListener('load', loaded)
    img.addEventListener('error', failed)
    return () => {
      img.removeEventListener('load', loaded)
      img.removeEventListener('error', failed)
      release()
    }
  }, [release, name])

  return <img ref={ref} src={src} alt={alt} style={style} />
}

/**
 * A recording's frame, decoded by the asset server with Talkie's ffmpeg. An <img> of the exact
 * frame rather than a <video> seeked to it: seeking a video frame by frame is what hung on
 * Playwright's VP8 files, and the headless shell cannot decode H.264 at all.
 */
export function OwnFootage({ src, trimBefore, trimAfter, style }: { src: string; trimBefore?: number; trimAfter?: number; style?: CSSProperties }): JSX.Element | null {
  const sourceFrame = (trimBefore ?? 0) + useOwnFrame()
  // Remotion's OffthreadVideo wrapped itself in a Sequence of length trimAfter: nothing after it.
  if (trimAfter !== undefined && sourceFrame >= trimAfter) return null
  const url = footageFrameUrl(src, sourceFrame, frameReader)
  return <OwnPicture key={url} src={url} style={style} label={`${nameOf(src)}, frame ${sourceFrame}`} />
}

/** Nothing in the picture: the export mixes the soundtrack from the timeline (soundtrack.ts). */
export function OwnSound(_props: { src: string }): null {
  return null
}
