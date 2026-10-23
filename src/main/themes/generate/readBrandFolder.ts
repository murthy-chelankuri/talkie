import { readdirSync, readFileSync, statSync } from 'fs'
import { extname, join } from 'path'
import { NO_FACTS, type BrandFacts } from './facts'
import { readLogo as readLogoDefault } from './readLogo'
import { readBrandGuide as readBrandGuideDefault } from './readBrandGuide'

const FONT_EXT = new Set(['.otf', '.ttf', '.woff', '.woff2'])
const IMAGE_EXT = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])
const TEXT_EXT = new Set(['.txt', '.md'])
const FONT_LABEL = /(?:[Tt]ypeface|[Ff]ont(?:\s+[Ff]amily)?|[Tt]ypography)\s*[:\-–—]\s*([A-Z][A-Za-z0-9]*(?:\s[A-Z][A-Za-z0-9]*){0,2})/g

/** A file whose name reads like a logo rather than a backdrop. */
function looksLikeLogo(name: string): boolean {
  return /logo|mark|icon|wordmark|lockup/i.test(name)
}

export interface BrandFolderDeps {
  readLogo: (bytes: Buffer, fileName: string) => Promise<BrandFacts>
  readBrandGuide: (bytes: Buffer) => Promise<BrandFacts>
}

/**
 * Everything a local brand folder offers — fonts, logos, background imagery and written colours
 * and typefaces — read without writing anything. Logos and backgrounds are carried as bytes for
 * the generator to copy in verbatim, at full quality. A file that cannot be read is skipped with a
 * problem rather than a throw: a brand folder is a grab-bag, and most of it making it through is
 * the point.
 */
export async function readBrandFolder(dir: string, deps: Partial<BrandFolderDeps> = {}): Promise<BrandFacts> {
  const readLogo = deps.readLogo ?? readLogoDefault
  const readBrandGuide = deps.readBrandGuide ?? readBrandGuideDefault
  const facts: BrandFacts = { ...NO_FACTS, colours: [], fonts: [], logos: [], backgrounds: [], palette: [], sources: ['folder'], problems: [] }

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (err) {
    return { ...facts, problems: [`Could not read the folder: ${err instanceof Error ? err.message : String(err)}`] }
  }

  for (const name of entries) {
    const path = join(dir, name)
    const ext = extname(name).toLowerCase()
    try {
      if (statSync(path).isDirectory()) continue
      const bytes = readFileSync(path)

      if (FONT_EXT.has(ext)) {
        // The family names itself when the file is written into the theme; here we only note it exists.
        facts.fonts.push({ family: name.slice(0, name.length - ext.length), role: 'document' })
      } else if (IMAGE_EXT.has(ext)) {
        if (looksLikeLogo(name) || ext === '.svg') {
          let ink: 'light' | 'dark' = 'dark'
          try {
            const read = await readLogo(bytes, name)
            const top = read.colours[0]
            if (top) {
              const [r, g, b] = [1, 3, 5].map((at) => parseInt(top.hex.slice(at, at + 2), 16))
              ink = 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? 'light' : 'dark'
            }
            // The logo's own colours are brand colours; they drive the AI's palette as they do when
            // a logo is uploaded on its own, so a folder designs a theme the way a website does.
            facts.colours.push(...read.colours)
          } catch {
            facts.problems.push(`Could not read the colours of ${name}; it was taken as a dark-ink logo.`)
          }
          facts.logos!.push({ bytes, fileName: name, ink })
          if (!facts.logo) facts.logo = { bytes, fileName: name }
        } else {
          // Large imagery suits a content slide; anything smaller a card.
          const suggest: 'card' | 'content' = bytes.length > 300 * 1024 ? 'content' : 'card'
          facts.backgrounds!.push({ bytes, fileName: name, suggest })
        }
      } else if (TEXT_EXT.has(ext)) {
        const text = bytes.toString('utf-8')
        for (const match of text.matchAll(/#([0-9a-f]{6})\b/gi)) {
          const hex = `#${match[1].toLowerCase()}`
          facts.colours.push({ hex, weight: 1000, role: 'document' })
          facts.palette!.push({ name: hex, hex })
        }
        for (const match of text.matchAll(FONT_LABEL)) facts.fonts.push({ family: match[1].trim(), role: 'document' })
      } else if (ext === '.pdf') {
        const guide = await readBrandGuide(bytes)
        facts.colours.push(...guide.colours)
        facts.fonts.push(...guide.fonts)
        facts.palette!.push(...guide.colours.map((colour) => ({ name: colour.hex, hex: colour.hex })))
      }
    } catch (err) {
      facts.problems.push(`Skipped ${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return facts
}
