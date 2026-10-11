import type { SceneTheme } from '../protocol'

/** The theme as CSS variables and loaded faces, so a scene written against them follows any theme. */
export async function applyTheme(doc: Document, theme: SceneTheme | null): Promise<void> {
  const root = doc.documentElement.style
  if (!theme) return
  root.setProperty('--talkie-bg', theme.background)
  root.setProperty('--talkie-heading', theme.heading)
  root.setProperty('--talkie-body', theme.body)
  root.setProperty('--talkie-accent', theme.accent)
  root.setProperty('--talkie-font-heading', `"${theme.fonts.heading.family}", ui-serif, Georgia, serif`)
  root.setProperty('--talkie-font-body', `"${theme.fonts.body.family}", ui-sans-serif, system-ui, sans-serif`)
  root.setProperty('--talkie-logo', theme.logo ? `url("${theme.logo}")` : 'none')
  const faces = [theme.fonts.heading, theme.fonts.body].flatMap(({ family, urls }) =>
    urls.map((url) => {
      const weight = /;name=[^;]*-(\d{3})/.exec(url)?.[1] ?? '400'
      return new FontFace(family, `url("${url}")`, { weight })
    })
  )
  for (const face of faces) {
    try { doc.fonts.add(await face.load()) } catch { /* a face that will not load falls back to the stack */ }
  }
}
