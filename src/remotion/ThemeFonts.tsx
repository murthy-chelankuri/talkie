import { useEffect, useMemo, useState } from 'react'
import { continueRender, delayRender } from 'remotion'
import { fontFaceCss, type RenderTheme } from './renderTheme'

export { fontFaceCss }

/**
 * The theme's own type, loaded before a frame is drawn.
 *
 * Held with delayRender because a face that arrives late is a video whose first second is in
 * the fallback font and then visibly changes. Released however loading ends: a font that fails
 * must cost the video its typeface, never the render itself.
 */
export function ThemeFonts({ theme }: { theme: RenderTheme }): JSX.Element | null {
  const css = useMemo(() => fontFaceCss(theme), [theme])
  const [handle] = useState(() => (css ? delayRender('Loading the theme’s fonts') : null))

  useEffect(() => {
    if (handle === null) return
    const families = [theme.fonts.heading, theme.fonts.body].filter((font) => font.urls.length > 0)
    Promise.all(families.map((font) => document.fonts.load(`1em "${font.family.replace(/"/g, '')}"`)))
      .catch(() => undefined)
      .finally(() => continueRender(handle))
  }, [handle, theme])

  return css ? <style>{css}</style> : null
}
