import { OffthreadVideo } from 'remotion'

export function VideoItem({ data }: { data: unknown }): JSX.Element {
  // Same constraint as ImageItem: `src` must already be a fetchable http URL by the time it
  // reaches here (resolveTimelineAssetUrls handles that), since Remotion serves compositions
  // from an http://localhost page and Chromium blocks file:// subresources on such pages.
  const { src } = data as { src: string }

  // OffthreadVideo, not Video: during rendering it extracts frames with Remotion's own
  // compositor instead of seeking an HTML5 <video>, which hangs indefinitely (delayRender
  // timeout) on the VP8 .webm files Playwright produces. In the Player it falls back to the
  // same preview component <Video> uses, so playback behaviour is unchanged.
  return <OffthreadVideo src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
}
