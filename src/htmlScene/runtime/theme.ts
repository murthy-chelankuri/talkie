import { TALKIE_FONT_FILES, type SceneTheme } from '../protocol'
import { plateAmong, readLogoColours } from '../../composition/logoLegibility'

/** The theme as CSS variables and loaded faces, so a scene written against them follows any theme. */
export async function applyTheme(doc: Document, theme: SceneTheme | null, talkieBase: string): Promise<void> {
  const root = doc.documentElement.style
  if (!theme) return
  root.setProperty('--talkie-bg', theme.background)
  root.setProperty('--talkie-heading', theme.heading)
  root.setProperty('--talkie-body', theme.body)
  root.setProperty('--talkie-accent', theme.accent)
  root.setProperty('--talkie-font-heading', `"${theme.fonts.heading.family}", ui-serif, Georgia, serif`)
  root.setProperty('--talkie-font-body', `"${theme.fonts.body.family}", ui-sans-serif, system-ui, sans-serif`)
  root.setProperty('--talkie-logo', theme.logo ? `url("${theme.logo}")` : 'none')
  // Read off the logo here, in the page, because only a browser sees an SVG the way the video
  // will — as LogoMark does for the video's own cards. Before the first frame, so none is bare.
  theme.logoPlate = theme.logo ? plateAmong(await readLogoColours(theme.logo), theme.background, theme.plates ?? []) : null
  root.setProperty('--talkie-logo-plate', theme.logoPlate ?? 'transparent')
  const faces = [theme.fonts.heading, theme.fonts.body].flatMap(({ family, urls }) => {
    // Talkie's own families have no files in the theme — every render already has them — so a
    // scene, which has none of the app's fonts, loads them from the runtime's server instead.
    if (urls.length === 0 && TALKIE_FONT_FILES[family]) {
      return [new FontFace(family, `url("${talkieBase}/${TALKIE_FONT_FILES[family]}")`, { weight: '100 900' })]
    }
    return urls.map((url) => {
      const weight = /;name=[^;]*-(\d{3})/.exec(url)?.[1] ?? '400'
      return new FontFace(family, `url("${url}")`, { weight })
    })
  })
  for (const face of faces) {
    try { doc.fonts.add(await face.load()) } catch { /* a face that will not load falls back to the stack */ }
  }
}
