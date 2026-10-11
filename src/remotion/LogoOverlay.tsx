import type { CSSProperties } from 'react'
import { useVideoConfig } from 'remotion'
import { useRenderTheme, type RenderTheme } from './renderTheme'
import { resolveSceneTheme } from './sceneTheme'
import { LogoMark } from './LogoMark'
import type { SceneStyle } from '../main/project/timeline/schema'

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
  const isSlide = kind === 'scene' || kind === 'diagram' || kind === 'html'
  if (isSlide && layout && layout !== 'standard') return null
  if (isSlide ? !logo.showOn.slides : !logo.showOn.recordings) return null

  const [vertical, horizontal] = logo.corner.split('-') as ['top' | 'bottom', 'left' | 'right']
  return { [vertical]: INSET, [horizontal]: INSET }
}

/** The logo in its corner. See LogoMark for how it is drawn, and when it gets a plate. */
export function LogoOverlay({ kind, data }: { kind: string; data: unknown }): JSX.Element | null {
  const theme = useRenderTheme()
  const { width, height } = useVideoConfig()
  const placement = logoPlacement(kind, data, theme)
  if (!placement || !theme?.logo) return null

  // A slide's ground is known; a recording's is whatever was on screen, so it is left alone.
  const isSlide = kind === 'scene' || kind === 'diagram' || kind === 'html'
  const background = isSlide ? resolveSceneTheme((data as { style?: SceneStyle } | null)?.style, theme).background : undefined

  return (
    <div style={{ position: 'absolute', ...placement, pointerEvents: 'none' }}>
      <LogoMark theme={{ ...theme, logo: theme.logo }} height={Math.round(height * 0.06)} maxWidth={Math.round(width * 0.18)} background={background} />
    </div>
  )
}
