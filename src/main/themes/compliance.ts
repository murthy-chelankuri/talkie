import type { PaletteColour, Theme, ThemeDraft, VariantId } from './schema'
import { VARIANT_IDS } from './schema'
import { contrastRatio } from './contrast'

/**
 * The brand check: everything about a theme that would read as off-brand or hard to read, said
 * as a warning and never as a block. A person — or an agent — sees the list and decides; a locked
 * group that fails is still only a warning, because the lock was a deliberate choice. Pure, so the
 * editor, the IPC layer and the MCP server all run the same check on the same draft.
 */

export interface ComplianceWarning {
  severity: 'warn'
  group: string
  message: string
}

/** WCAG floors, the same ones the contrast fix holds a theme to. */
const FLOOR = { heading: 3, body: 4.5, accent: 3 } as const
/** Below this a scrim leaves too little tone for text to sit on an image. */
const MIN_SCRIM = 0.3
/** A corner logo is about 6% of a 1080-high frame; a minimum height past that cannot be honoured. */
const CORNER_LOGO_PX = Math.round(1080 * 0.06)
/** How far, in plain RGB distance, a colour may be from the palette before it reads as off-brand. */
const NEAR = 40

type Checkable = Theme | ThemeDraft

function rgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number]
}

function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

export function checkCompliance(theme: Checkable): ComplianceWarning[] {
  const warnings: ComplianceWarning[] = []
  const warn = (group: string, message: string): void => void warnings.push({ severity: 'warn', group, message })

  // Contrast, per variant — a locked variant the fixer could not repair shows up here.
  for (const id of VARIANT_IDS as readonly VariantId[]) {
    const v = theme.variants[id]
    for (const role of ['heading', 'body', 'accent'] as const) {
      if (contrastRatio(v[role], v.background) < FLOOR[role]) {
        warn(`variants.${id}`, `${id} ${role} (${v[role]}) is hard to read on ${v.background}.`)
      }
    }
  }

  // Backgrounds: a scrim too light to carry text.
  const backgrounds = theme.backgrounds
  if (backgrounds) {
    for (const ctx of ['card', 'content'] as const) {
      for (const id of VARIANT_IDS as readonly VariantId[]) {
        const entry = backgrounds[ctx]?.[id]
        if (entry && entry.scrim < MIN_SCRIM) {
          warn('backgrounds', `The ${ctx} ${id} background has a low scrim (${entry.scrim}); text over it may be hard to read.`)
        }
      }
    }
  }

  // Off-palette: a variant colour nowhere near a declared brand colour.
  const palette: PaletteColour[] | undefined = theme.brand?.palette
  if (palette && palette.length > 0) {
    for (const id of VARIANT_IDS as readonly VariantId[]) {
      const v = theme.variants[id]
      for (const role of ['background', 'heading', 'body', 'accent'] as const) {
        const nearest = Math.min(...palette.map((p) => distance(v[role], p.hex)))
        if (nearest > NEAR) {
          warn(`variants.${id}`, `${id} ${role} (${v[role]}) is not in the brand palette.`)
        }
      }
    }
  }

  // Logos: a missing counterpart, and a minimum height a corner logo cannot meet.
  const logo = theme.logo
  if (logo) {
    if ((logo.light && !logo.dark) || (logo.dark && !logo.light)) {
      const missing = logo.dark ? 'light' : 'dark'
      warn('logo', `There is no ${missing}-background logo; the other will be plated on ${missing} surfaces.`)
    }
    if (logo.minHeight !== undefined && logo.minHeight > CORNER_LOGO_PX) {
      warn('logo', `The logo's minimum height (${logo.minHeight}px) is taller than a corner logo is drawn (${CORNER_LOGO_PX}px).`)
    }
  }

  return warnings
}
