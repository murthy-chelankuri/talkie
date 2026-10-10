import type { VariantId } from './schema'
import type { RenderTheme } from '../../remotion/renderTheme'
import { VARIANT_FOR } from '../../remotion/sceneTheme'

/**
 * Raised when the way a themed diagram is drawn changes, so every one drawn the old way is drawn
 * again. 2: painted on its look's own background rather than always on Talkie's dark grey, which
 * left a light diagram as dark text on a dark ground.
 */
const DRAWING_VERSION = 2

/**
 * Which theme a diagram was drawn in.
 *
 * Mermaid writes colours into the SVG, so a drawn diagram is a picture of one theme — and of one
 * variant of it, since a diagram on a light slide is drawn in dark ink. Pure, because the window
 * asks this when it opens a project as well as main before an export.
 */
export function diagramStamp(theme: RenderTheme, variant: VariantId): string {
  return `${theme.stamp}:${variant}:${DRAWING_VERSION}`
}

interface DiagramLike {
  id: string
  kind: string
  data?: unknown
}

/** The variant a diagram's style asks for, with the older palette names read as their nearest. */
export function diagramVariant(data: unknown): VariantId {
  const name = (data as { style?: { theme?: keyof typeof VARIANT_FOR } } | null)?.style?.theme ?? 'dark'
  return VARIANT_FOR[name] ?? 'dark'
}

/**
 * Diagrams whose picture no longer matches the project: never drawn, drawn in a different theme
 * or variant, or drawn in a theme the project has since dropped. A diagram drawn before themes
 * existed, in a project still without one, is exactly as it should be and is left alone.
 */
export function staleDiagrams<T extends DiagramLike>(timeline: T[], theme: RenderTheme | null): T[] {
  return timeline.filter((item) => {
    if (item.kind !== 'diagram') return false
    const data = item.data as { source?: string; src?: string; themeStamp?: string } | null
    if (!data?.source?.trim()) return false
    if (!data.src) return true
    if (!theme) return Boolean(data.themeStamp)
    return data.themeStamp !== diagramStamp(theme, diagramVariant(data))
  })
}
