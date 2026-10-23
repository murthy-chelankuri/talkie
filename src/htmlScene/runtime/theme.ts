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
  if (theme.bgImage) {
    root.setProperty('--talkie-bg-image', `url("${theme.bgImage.url}")`)
    root.setProperty('--talkie-bg-fit', theme.bgImage.fit)
    root.setProperty('--talkie-bg-scrim', String(theme.bgImage.scrim))
    injectBackgroundLayer(doc, theme)
  }
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

/**
 * A full-bleed layer behind the page carrying the theme's background image and a scrim — the same
 * solid → image → scrim order the native scenes paint — so a scene written against the theme
 * variables gets the imagery without its template knowing of it. The image is a data URL from the
 * theme's own folder, so connect-src 'none' is untouched. Idempotent, because applyTheme runs
 * again on every talkie:theme message; a template that paints its own body background opts out.
 */
function injectBackgroundLayer(doc: Document, theme: SceneTheme): void {
  const id = '__talkie-bg'
  if (!theme.bgImage || doc.getElementById(id)) return
  const fit = theme.bgImage.fit
  const size = fit === 'tile' ? 'background-repeat:repeat;background-size:auto' : `background-repeat:no-repeat;background-position:center;background-size:${fit}`
  const layer = doc.createElement('div')
  layer.id = id
  layer.setAttribute('aria-hidden', 'true')
  layer.style.cssText = `position:fixed;inset:0;z-index:-1;pointer-events:none;background-color:${theme.background}`
  const image = doc.createElement('div')
  image.style.cssText = `position:absolute;inset:0;background-image:var(--talkie-bg-image);${size}`
  const scrim = doc.createElement('div')
  scrim.style.cssText = `position:absolute;inset:0;background:${theme.background};opacity:${theme.bgImage.scrim}`
  layer.append(image, scrim)
  ;(doc.body ?? doc.documentElement).prepend(layer)
}
