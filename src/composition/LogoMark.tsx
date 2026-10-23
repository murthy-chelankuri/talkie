import { useEffect, useState } from 'react'
import { Picture, hold } from '../video'
import type { RenderTheme } from './renderTheme'
import { logoPlate, readLogoColours, type LogoColours } from './logoLegibility'

/**
 * The theme's logo at a given height, on a plate where the background would swallow it.
 *
 * Drawn as an image and never as inline SVG: a logo can come from a company's website, and an
 * image element does not run whatever script that markup might carry. Its colours are read before
 * the frame is taken, so a frame never shows the logo bare and the next one plated.
 */
export function LogoMark({
  theme,
  url,
  height,
  maxWidth,
  background
}: {
  theme: RenderTheme
  /** The logo chosen for this surface — see logoUrlFor, which picks the light or dark mark. */
  url: string
  height: number
  maxWidth: number
  /** What it sits on, when that is known — not over a recording, which is footage of anything. */
  background?: string
}): JSX.Element {
  const [colours, setColours] = useState<LogoColours | null | undefined>(undefined)

  useEffect(() => {
    if (!background) return
    let wanted = true
    const release = hold('Reading the logo’s colours')
    void readLogoColours(url).then((read) => {
      if (wanted) setColours(read)
      release()
    })
    return () => {
      wanted = false
      release()
    }
  }, [url, background])

  const plate = logoPlate(colours ?? null, background, theme)
  const image = (
    <Picture
      src={url}
      alt=""
      style={{ display: 'block', height: plate ? height * 0.72 : height, maxWidth: plate ? maxWidth * 0.8 : maxWidth, objectFit: 'contain' }}
    />
  )
  if (!plate) return image

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height,
        maxWidth,
        padding: `0 ${Math.round(height * 0.28)}px`,
        borderRadius: Math.round(height * 0.18),
        background: plate,
        boxSizing: 'border-box'
      }}
    >
      {image}
    </div>
  )
}
