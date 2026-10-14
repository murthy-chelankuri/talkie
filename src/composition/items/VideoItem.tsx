import { Footage, useFrame } from '../../video'
import { zoomAt, type ClickFocus } from '../clickZoom'

export function VideoItem({ data }: { data: unknown }): JSX.Element {
  // Same constraint as ImageItem: `src` must already be a fetchable http URL by the time it
  // reaches here (resolveTimelineAssetUrls handles that), since the composition is served
  // from an http page and Chromium blocks file:// subresources on such pages.
  const { src, trimBefore, trimAfter, focus } = data as {
    src: string
    trimBefore?: number
    trimAfter?: number
    focus?: ClickFocus[]
  }

  // A recording is a wide, even picture of a whole window, and cannot say where to look. The
  // recorder wrote down where every click landed, so the picture leans towards them — see
  // clickZoom.ts for why the move is as small as it is.
  const zoom = zoomAt(useFrame(), focus ?? [])

  // trimBefore skips the blank page a browser recording opens with, so cutting to this clip
  // lands on actual content instead of a white screen. trimAfter stops it where the next scene
  // of the same recording begins: without it a scene whose narration ran long would play on
  // into footage the following scene is about to play again.
  return (
    <Footage
      src={src}
      trimBefore={trimBefore}
      trimAfter={trimAfter}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: `scale(${zoom.scale})`,
        transformOrigin: `${zoom.originX}% ${zoom.originY}%`
      }}
    />
  )
}
