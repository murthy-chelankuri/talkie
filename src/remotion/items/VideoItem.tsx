import { OffthreadVideo } from 'remotion'

export function VideoItem({ data }: { data: unknown }): JSX.Element {
  // Same constraint as ImageItem: `src` must already be a fetchable http URL by the time it
  // reaches here (resolveTimelineAssetUrls handles that), since Remotion serves compositions
  // from an http://localhost page and Chromium blocks file:// subresources on such pages.
  const { src, trimBefore } = data as { src: string; trimBefore?: number }

  // OffthreadVideo, not Video: during rendering it extracts frames with Remotion's own
  // compositor instead of seeking an HTML5 <video>, which hangs indefinitely (delayRender
  // timeout) on the VP8 .webm files Playwright produces. In the Player it falls back to the
  // same preview component <Video> uses, so playback behaviour is unchanged.
  // trimBefore skips the blank page a browser recording opens with, so cutting to this clip
  // lands on actual content instead of a white screen.
  return (
    <OffthreadVideo
      src={src}
      trimBefore={trimBefore}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  )
}
