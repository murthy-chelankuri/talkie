import { Img } from 'remotion'

// Matches an already-present URL scheme (file://, http://, https://, data:, ...).
const HAS_URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i

export function ImageItem({ data }: { data: unknown }): JSX.Element {
  const { src } = data as { src: string }
  // A bare filesystem path (no scheme) is treated as a local absolute path and converted
  // to a file:// URL. A src that already carries a scheme is passed through unchanged.
  const url = HAS_URL_SCHEME.test(src) ? src : `file://${src}`

  return <Img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
}
