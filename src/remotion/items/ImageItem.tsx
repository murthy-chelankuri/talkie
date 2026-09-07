import { Img } from 'remotion'

export function ImageItem({ data }: { data: unknown }): JSX.Element {
  // data.src must already be a fetchable URL (http://...) by the time it reaches this
  // component — Remotion's headless Chromium cannot load file:// subresources from the
  // http://localhost page it serves compositions from. Callers resolve local project
  // paths to URLs via resolveTimelineAssetUrls (assetServer.ts) before this ever runs.
  const { src } = data as { src: string }

  return <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
}
