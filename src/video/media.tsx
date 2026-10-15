import type { CSSProperties } from 'react'
import { OwnFootage, OwnPicture, OwnSound } from './own/media'

/**
 * Pictures, footage and sound, each held until it can be shown at the frame asked for.
 * Every `src` must already be an http URL from the asset server: the export page is served
 * over http, and Chromium will not load file:// beneath it (see resolveTimelineAssetUrls).
 */

export function Picture({ src, alt, style }: { src: string; alt?: string; style?: CSSProperties }): JSX.Element {
  // Keyed on src: the picture opens its hold once, so a new src must be a new picture with a new hold,
  // or a frame could be taken before the new image has loaded.
  return <OwnPicture key={src} src={src} alt={alt} style={style} />
}

/**
 * A recording, from `trimBefore` up to `trimAfter`. Both count composition frames, so seconds
 * into the file are the value over the composition's fps, not frames of the file.
 *
 * Like `Sound`, it starts at the enclosing Sequence's first frame and stops at its last, nested
 * Sequences included. The export draws each exact frame as a picture; the preview plays it as an
 * ordinary video (own/media.tsx).
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
}): JSX.Element | null {
  return <OwnFootage src={src} trimBefore={trimBefore} trimAfter={trimAfter} style={style} />
}

/**
 * Narration, starting at the enclosing Sequence's first frame and stopping at its last. A
 * nested Sequence ends with its parent, so a take longer than its clip is cut at the clip's end.
 */
export function Sound({ src }: { src: string }): JSX.Element | null {
  return <OwnSound src={src} />
}
