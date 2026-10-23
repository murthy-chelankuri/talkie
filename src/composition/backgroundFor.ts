import type { VariantId } from '../main/themes/schema'
import type { RenderTheme } from './renderTheme'

/**
 * The background image for a surface, or nothing. A diagram never calls this — it keeps its solid
 * themed ground so its structure reads — so the only contexts are a card and a content slide.
 */
export function backgroundFor(
  theme: RenderTheme | null | undefined,
  context: 'card' | 'content',
  variant: VariantId
): { url: string; fit: 'cover' | 'contain' | 'tile'; scrim: number } | undefined {
  return theme?.backgrounds?.[context]?.[variant]
}
