import type { CSSProperties } from 'react'
import { Img } from 'remotion'
import { useRenderTheme, type RenderTheme } from './renderTheme'

const INSET = '4%'

/**
 * Where the logo goes over this clip, or null for nowhere.
 *
 * Recordings and slides are separate choices because a logo over someone's product can read as
 * a claim about it. Never on an opening or closing card: those show the logo large already, and
 * a second small one in the corner looks like a mistake.
 */
export function logoPlacement(kind: string, data: unknown, theme: RenderTheme | null): CSSProperties | null {
  const logo = theme?.logo
  if (!logo) return null

  const layout = (data as { layout?: string } | null)?.layout
  const isSlide = kind === 'scene' || kind === 'diagram'
  if (isSlide && layout && layout !== 'standard') return null
  if (isSlide ? !logo.showOn.slides : !logo.showOn.recordings) return null

  const [vertical, horizontal] = logo.corner.split('-') as ['top' | 'bottom', 'left' | 'right']
  return { [vertical]: INSET, [horizontal]: INSET }
}

/**
 * The logo, drawn as an image and never as inline SVG: a logo can come from a company's website,
 * and an image element does not run whatever script that markup might carry.
 */
export function LogoOverlay({ kind, data }: { kind: string; data: unknown }): JSX.Element | null {
  const theme = useRenderTheme()
  const placement = logoPlacement(kind, data, theme)
  if (!placement || !theme?.logo) return null

  return (
    <Img
      src={theme.logo.url}
      alt=""
      style={{
        position: 'absolute',
        ...placement,
        height: '6%',
        maxWidth: '18%',
        objectFit: 'contain',
        pointerEvents: 'none'
      }}
    />
  )
}
