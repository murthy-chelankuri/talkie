/**
 * What could be read about a brand before anyone — or any model — chose anything.
 *
 * Kept as facts with weights rather than as a palette, so the step that does choose can see how
 * much of the page each colour covered, and so a colour found on the site and in the logo counts
 * for more than one found once.
 */
export type ColourRole = 'background' | 'text' | 'button' | 'link' | 'heading' | 'logo' | 'document'

export interface BrandFacts {
  colours: { hex: string; weight: number; role: ColourRole }[]
  fonts: { family: string; role: 'heading' | 'body' | 'document' }[]
  logo?: { bytes: Buffer; fileName: string }
  /** Every logo read, with the ground it is made for — the slot it belongs in (light-ink → dark ground). */
  logos?: { bytes: Buffer; fileName: string; ink: 'light' | 'dark' }[]
  /** Imagery to sit behind scenes, tagged by where it suits. Carried as bytes to copy in verbatim. */
  backgrounds?: { bytes: Buffer; fileName: string; suggest: 'card' | 'content' }[]
  /** Named brand colours, from a guide or folder, for the palette and the off-palette check. */
  palette?: { name: string; hex: string }[]
  sources: ('website' | 'logo' | 'pdf' | 'description' | 'folder')[]
  /** What went wrong on the way, said plainly — "acme.com asked for a sign-in". */
  problems: string[]
}

export const NO_FACTS: BrandFacts = { colours: [], fonts: [], sources: [], problems: [] }

export function mergeFacts(...all: BrandFacts[]): BrandFacts {
  const colours = new Map<string, { hex: string; weight: number; role: ColourRole; heaviest: number }>()
  for (const facts of all) {
    for (const colour of facts.colours) {
      const seen = colours.get(colour.hex)
      if (!seen) {
        colours.set(colour.hex, { ...colour, heaviest: colour.weight })
        continue
      }
      seen.weight += colour.weight
      // The role is the one it played most: a colour that is mostly a button is a button colour.
      if (colour.weight > seen.heaviest) {
        seen.role = colour.role
        seen.heaviest = colour.weight
      }
    }
  }

  const fonts = all.flatMap((facts) => facts.fonts)
  const palette = all.flatMap((facts) => facts.palette ?? [])
  const logos = all.flatMap((facts) => facts.logos ?? [])
  const backgrounds = all.flatMap((facts) => facts.backgrounds ?? [])
  return {
    colours: [...colours.values()]
      .sort((a, b) => b.weight - a.weight)
      .map(({ hex, weight, role }) => ({ hex, weight, role })),
    fonts: fonts.filter((font, i) => fonts.findIndex((other) => other.family === font.family && other.role === font.role) === i),
    logo: all.find((facts) => facts.logo)?.logo,
    ...(logos.length ? { logos } : {}),
    ...(backgrounds.length ? { backgrounds } : {}),
    ...(palette.length ? { palette: palette.filter((p, i) => palette.findIndex((other) => other.hex === p.hex) === i) } : {}),
    sources: [...new Set(all.flatMap((facts) => facts.sources))],
    problems: all.flatMap((facts) => facts.problems)
  }
}

/** `rgb(10, 37, 64)` or `rgba(…)` as `#0a2540`, or null for anything transparent. */
export function cssColourToHex(value: string): string | null {
  const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(value)
  if (!match) return null
  if (match[4] !== undefined && Number(match[4]) < 0.5) return null
  return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`
}
