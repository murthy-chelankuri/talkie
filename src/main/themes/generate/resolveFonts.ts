import { BUILTIN_FONTS, type FontChoice, type ThemeDraft } from '../schema'
import type { FontFallbacks } from './ruleBasedTheme'

/**
 * Turn the families a theme names into files it can carry — for open fonts only.
 *
 * A brand's own font is often commercial, licensed to that company and nobody else, and cannot be
 * fetched from anywhere. Google Fonts publishes each family under a folder named for its licence
 * in google/fonts; only `ofl/` and `apache/` are taken, which is what makes it safe to keep the
 * files with the theme. Anything else uses the open stand-in the proposal chose, or Talkie's own
 * type — and says so, so the person knows to add the real files if they hold them.
 */

const REPOSITORY = 'https://raw.githubusercontent.com/google/fonts/main'
/** Google serves WOFF2 only to browsers that say they read it. */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

export interface FontFile {
  role: 'heading' | 'body'
  /** Relative to the theme's folder: `fonts/Inter-600.woff2`. */
  fileName: string
  bytes: Buffer
}

function folderName(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function isOpen(family: string, fetcher: typeof fetch): Promise<boolean> {
  for (const licence of ['ofl', 'apache']) {
    const response = await fetcher(`${REPOSITORY}/${licence}/${folderName(family)}/METADATA.pb`)
    if (response.ok) return true
  }
  return false
}

/** The latin regular and semibold, by the URLs in Google's CSS for the family. */
async function download(family: string, fetcher: typeof fetch): Promise<{ weight: string; bytes: Buffer }[]> {
  const name = encodeURIComponent(family).replace(/%20/g, '+')
  let css = await fetcher(`https://fonts.googleapis.com/css2?family=${name}:wght@400;600&display=swap`, { headers: { 'user-agent': BROWSER_UA } })
  // A family with one weight refuses a request for two; asked plainly it gives what it has.
  if (!css.ok) css = await fetcher(`https://fonts.googleapis.com/css2?family=${name}&display=swap`, { headers: { 'user-agent': BROWSER_UA } })
  if (!css.ok) throw new Error(`Google Fonts would not serve ${family}.`)

  const faces = (await css.text()).split('/*').filter((block) => /^\s*latin\s*\*\//.test(block))
  const files: { weight: string; bytes: Buffer }[] = []
  for (const face of faces) {
    const weight = /font-weight:\s*(\d+)/.exec(face)?.[1] ?? '400'
    const url = /src:\s*url\(([^)]+\.woff2)\)/.exec(face)?.[1]
    if (!url || files.some((file) => file.weight === weight)) continue
    const response = await fetcher(url)
    if (!response.ok) throw new Error(`Could not download ${family} ${weight}.`)
    files.push({ weight, bytes: Buffer.from(await response.arrayBuffer()) })
  }
  if (files.length === 0) throw new Error(`Google Fonts had no Latin files for ${family}.`)
  return files
}

export async function resolveFonts(
  draft: ThemeDraft,
  fallbacks: FontFallbacks,
  fetcher: typeof fetch = fetch
): Promise<{ draft: ThemeDraft; files: FontFile[]; notes: string[] }> {
  const notes: string[] = []
  const files: FontFile[] = []
  const fetched = new Map<string, string[] | null>()
  const explained = new Set<string>()

  /** The files for a family, fetched once even when heading and body share it. */
  const filesFor = async (family: string, role: 'heading' | 'body'): Promise<string[] | null> => {
    if (fetched.has(family)) return fetched.get(family) ?? null
    let names: string[] | null = null
    try {
      if (await isOpen(family, fetcher)) {
        const downloaded = await download(family, fetcher)
        names = downloaded.map(({ weight, bytes }) => {
          const fileName = `fonts/${family.replace(/[^\w]+/g, '')}-${weight}.woff2`
          files.push({ role, fileName, bytes })
          return fileName
        })
      }
    } catch (err) {
      notes.push(`Could not get ${family} from Google Fonts (${err instanceof Error ? err.message : String(err)}).`)
    }
    fetched.set(family, names)
    return names
  }

  const choose = async (choice: FontChoice, role: 'heading' | 'body'): Promise<FontChoice> => {
    const builtin: FontChoice = { family: role === 'heading' ? BUILTIN_FONTS.serif : BUILTIN_FONTS.sans, source: 'builtin', files: [] }
    if (choice.source !== 'google') return choice

    const own = await filesFor(choice.family, role)
    if (own) return { family: choice.family, source: 'google', files: own }

    // Said once per font: a brand that sets everything in one family would otherwise be told twice.
    const say = (note: string): void => {
      if (!explained.has(choice.family)) notes.push(note)
      explained.add(choice.family)
    }
    const standIn = fallbacks[role]
    if (standIn && standIn !== choice.family) {
      const open = await filesFor(standIn, role)
      if (open) {
        say(`${choice.family} is not an open font Talkie can fetch, so ${standIn} stands in for it. Add your own ${choice.family} files to use the real one.`)
        return { family: standIn, source: 'google', files: open }
      }
    }
    say(`Using Talkie's own type, because ${choice.family} could not be fetched. Add its files to use it.`)
    return builtin
  }

  const heading = await choose(draft.fonts.heading, 'heading')
  const body = await choose(draft.fonts.body, 'body')
  return { draft: { ...draft, fonts: { heading, body } }, files, notes }
}
