import type { CSSProperties } from 'react'
import { Audio, Img, OffthreadVideo } from 'remotion'

/**
 * Pictures, footage and sound, each held until it can be shown at the frame asked for.
 * Every `src` must already be an http URL from the asset server: the export page is served
 * over http, and Chromium will not load file:// beneath it (see resolveTimelineAssetUrls).
 *
 * Delegates to Remotion until steps 3 and 4 of the renderer.
 */

export function Picture({ src, alt, style }: { src: string; alt?: string; style?: CSSProperties }): JSX.Element {
  return <Img src={src} alt={alt} style={style} />
}

/**
 * A recording, from `trimBefore` up to `trimAfter` (frames into the file).
 *
 * OffthreadVideo, not Video: an HTML5 <video> seeked frame by frame hangs on the VP8 .webm
 * files Playwright produces, so the export takes frames from the compositor instead. In the
 * preview it plays as an ordinary video.
 */
export function Footage({
  src,
  trimBefore,
  trimAfter,
  style
}: {
  src: string
  trimBefore?: number
  trimAfter?: number
  style?: CSSProperties
}): JSX.Element {
  return <OffthreadVideo src={src} trimBefore={trimBefore} trimAfter={trimAfter} style={style} />
}

/** Narration, starting at the enclosing Sequence's first frame. */
export function Sound({ src }: { src: string }): JSX.Element {
  return <Audio src={src} />
}
