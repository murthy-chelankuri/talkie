import { useEffect, useMemo, useState } from 'react'
import { hold } from '../video'
import { fontFaceCss, type RenderTheme } from './renderTheme'

export { fontFaceCss }

/**
 * The theme's own type, loaded before a frame is drawn.
 *
 * Held because a face that arrives late is a video whose first second is in
 * the fallback font and then visibly changes. Released however loading ends: a font that fails
 * must cost the video its typeface, never the render itself.
 */
export function ThemeFonts({ theme }: { theme: RenderTheme }): JSX.Element | null {
  const css = useMemo(() => fontFaceCss(theme), [theme])
  const [release] = useState(() => (css ? hold('Loading the theme’s fonts') : null))

  useEffect(() => {
    if (release === null) return
    const families = [theme.fonts.heading, theme.fonts.body].filter((font) => font.urls.length > 0)
    Promise.all(families.map((font) => document.fonts.load(`1em "${font.family.replace(/"/g, '')}"`)))
      .catch(() => undefined)
      .finally(release)
  }, [release, theme])

  return css ? <style>{css}</style> : null
}
