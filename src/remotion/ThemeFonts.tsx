import { useEffect, useMemo, useState } from 'react'
import { continueRender, delayRender } from 'remotion'
import type { RenderTheme } from './renderTheme'

/** "Inter-600" → 600; a file whose name says nothing covers every weight. */
function weightOf(url: string): string {
  const name = /;name=([\w-]+)/.exec(url)?.[1] ?? ''
  const weight = /(?:^|[-_])([1-9]00)(?:$|[-_])/.exec(name)?.[1]
  return weight ?? '100 900'
}

/** The @font-face rules for the families a theme brings files for. Empty when it brings none. */
export function fontFaceCss(theme: RenderTheme): string {
  const families = [theme.fonts.heading, theme.fonts.body]
  const seen = new Set<string>()
  const rules: string[] = []

  for (const { family, urls } of families) {
    for (const url of urls) {
      const key = `${family}|${url}`
      if (seen.has(key)) continue
      seen.add(key)
      rules.push(
        `@font-face{font-family:"${family.replace(/"/g, '')}";src:url(${url});font-weight:${weightOf(url)};font-style:normal;font-display:block}`
      )
    }
  }
  return rules.join('\n')
}

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
