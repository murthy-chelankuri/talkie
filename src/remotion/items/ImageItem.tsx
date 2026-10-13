import { Picture } from '../../video'

export function ImageItem({ data }: { data: unknown }): JSX.Element {
  // data.src must already be a fetchable URL (http://...) by the time it reaches this
  // component — the export's headless Chromium cannot load file:// subresources from the
  // http page the composition is served from. Callers resolve local project
  // paths to URLs via resolveTimelineAssetUrls (assetServer.ts) before this ever runs.
  const { src } = data as { src: string }

  return <Picture src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
}
