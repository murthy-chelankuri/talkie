# Enhanced Corporate Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Talkie's theme system to hold a corporate brand strictly — a light/dark-background logo pair, per-surface background images, a brand palette, coarse per-group locks with a warn-only compliance check, and AI generation from a local brand folder — with every asset copied into the theme folder so a Studio shared over git carries the whole brand.

**Architecture:** Extend in place. Bump `THEME_SCHEMA_VERSION` 1→2 and add typed fields to `src/main/themes/schema.ts`; keep the folder-per-theme layout, the `RenderTheme` data-URL inlining, and the HTML-scene sandbox exactly as they are. Logo-by-surface is resolved on the composition side so `SceneTheme` still carries a single logo URL and the sandbox is untouched. Backgrounds are stored byte-for-byte and inlined with a size ceiling that warns rather than downscales.

**Tech Stack:** TypeScript, zod (schema), React (composition + renderer), Electron IPC, vitest, Playwright (readLogo/readWebsite), pdfjs (brand guide), Node fs. British spelling in user-facing text and names.

**Spec:** `docs/superpowers/specs/2026-10-23-enhanced-themes-design.md`

## Global Constraints

- **British spelling** in user-facing text and names (colour, licence, sanitise).
- **Comments say why, not what** — match the codebase's density; explain the failure that shaped a decision, never narrate the code.
- **Pure zod, no Node, in `schema.ts`** — the composition imports these types and runs in a browser.
- **`RenderTheme` carries assets as data URLs, never asset-server URLs** — that server is rooted at the projects folder and widening it would expose `settings.json` (API keys). All logo/background/font inlining stays in `toRenderTheme.ts`.
- **HTML scenes stay `sandbox="allow-scripts"`, `connect-src 'none'`, assets from their own folder only** — no change relaxes this. Logo-by-surface is resolved before a URL reaches a scene; background images are injected as data URLs.
- **Store assets verbatim** — never re-encode or downscale a logo or background. Inline with a ceiling that drops-with-warning.
- **Diagrams keep their solid themed background** — `diagramStamp` is untouched; backgrounds never apply behind a diagram.
- **AI themes start unlocked.**
- **Built-in themes** (`builtin-*`) must keep passing `builtinThemes.test.ts` and `contrast.test.ts`: they carry no backgrounds, no palette, no locks, and their single logo mirrors into both slots.
- Run `npm run typecheck` and the relevant `npm test` files before each commit; both must pass (git hooks enforce it).

---

## File Structure

**Created:**
- `src/main/themes/generate/readBrandFolder.ts` — classify a local brand directory into `BrandFacts` (fonts, logos, backgrounds, docs).
- `src/main/themes/generate/readBrandFolder.test.ts`
- `src/main/themes/compliance.ts` — `checkCompliance(theme)` pure warning check.
- `src/main/themes/compliance.test.ts`

**Modified:**
- `src/main/themes/schema.ts` — v2 fields (logo pair, backgrounds, brand.palette, locks), version bump, migration helper.
- `src/main/themes/schema.test.ts` — migration + new-field tests.
- `src/main/themes/themeApi.ts` — `writeAssetInto`/`writeThemeAsset` generalized to backgrounds + slots; `MAX_BACKGROUND_BYTES`.
- `src/main/themes/themeApi.test.ts` (or nearest existing test) — asset writing tests.
- `src/main/themes/toRenderTheme.ts` — read logo pair + backgrounds → data URLs with ceiling; feed `themeStamp`.
- `src/composition/renderTheme.ts` — `RenderTheme` v2 type; `themeStamp` folds in logo/background; `logoUrlFor` helper.
- `src/composition/sceneTheme.ts` — `resolveSceneTheme` returns a resolved background entry.
- `src/composition/LogoMark.tsx`, `LogoOverlay.tsx` — pick logo URL by surface.
- `src/composition/items/TextScene.tsx` — paint background image + scrim under content.
- `src/composition/backgroundFor.ts` (new small module) + test — pick a background entry for context/variant.
- `src/htmlScene/protocol.ts` — `SceneTheme` carries resolved logo + background; `sceneThemeOf` resolves them.
- `src/htmlScene/runtime/theme.ts` — set `--talkie-bg-image`/`-fit`/`-scrim` and inject the layer.
- `src/main/themes/contrast.ts` — `fixContrast(draft, locks?)` returns `{ draft, notes, unresolved }`.
- `src/main/themes/contrast.test.ts` — lock-aware tests.
- `src/main/ipc/themeHandlers.ts` — generalized `addAsset`, new `compliance` channel.
- `src/main/themes/generate/facts.ts` — `BrandFacts` grows `backgrounds[]`, `palette[]`.
- `src/main/themes/generate/generateTheme.ts` — `GenerateRequest` grows `folder?`/`files?`; assign logos/backgrounds/palette; stay unlocked.
- `src/main/themes/generate/proposeTheme.ts` — propose a palette.
- `src/main/themes/generate/readWebsite.ts` — harvest background candidates.
- `src/mcp/server.ts` — v2 fields on create/update/theme tools; lock rejection; compliance in read.
- `src/renderer/src/components/themes/ThemeEditor.tsx` — Logos (light/dark), Backgrounds, Palette, lock toggles, Brand check panel.

---

## Task 1: Schema v2 — types, version bump, migration

**Files:**
- Modify: `src/main/themes/schema.ts`
- Test: `src/main/themes/schema.test.ts`

**Interfaces:**
- Consumes: existing `HexColourSchema`, `LOGO_CORNERS`, `VARIANT_IDS`, `ThemeFields`, `ThemeSchema`.
- Produces:
  - `THEME_SCHEMA_VERSION = 2`
  - `LOGO_SLOTS = ['light','dark'] as const`, type `LogoSlot`
  - `BackgroundFitSchema = z.enum(['cover','contain','tile'])`, type `BackgroundFit`
  - `BackgroundEntrySchema` → `{ file: string, fit: BackgroundFit (default 'cover'), scrim: number (0..1, default 0.35) }`, type `BackgroundEntry`
  - `BackgroundContextSchema` → `{ brand?: BackgroundEntry, light?: BackgroundEntry, dark?: BackgroundEntry }`
  - `ThemeBackgroundsSchema` → `{ card?: BackgroundContext, content?: BackgroundContext }`, type `ThemeBackgrounds`
  - `ThemeLogoSchema` (reshaped): `{ light?: {file}, dark?: {file}, corner (default 'bottom-right'), showOn (default {}), clearSpace?: number, minHeight?: number }`, type `ThemeLogo`
  - `PaletteColourSchema` → `{ name: string, hex: HexColour }`; `BrandSchema` → `{ palette?: PaletteColour[] }`
  - `LOCK_KEYS = ['variants.brand','variants.light','variants.dark','fonts.heading','fonts.body','logo','backgrounds'] as const`, type `LockKey`, `LockKeySchema = z.enum(LOCK_KEYS)`
  - `migrateTheme(raw: unknown): unknown` — v1→v2 upgrade applied before `ThemeSchema.parse`.

- [ ] **Step 1: Write failing tests for the new schema + migration**

Add to `src/main/themes/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ThemeSchema, ThemeLogoSchema, BackgroundEntrySchema, LOCK_KEYS, THEME_SCHEMA_VERSION, migrateTheme } from './schema'

describe('schema v2', () => {
  it('is version 2', () => {
    expect(THEME_SCHEMA_VERSION).toBe(2)
  })

  it('reads a logo as a light/dark pair with placement', () => {
    const logo = ThemeLogoSchema.parse({ light: { file: 'logos/light.svg' }, dark: { file: 'logos/dark.svg' }, clearSpace: 0.5, minHeight: 24 })
    expect(logo.light?.file).toBe('logos/light.svg')
    expect(logo.dark?.file).toBe('logos/dark.svg')
    expect(logo.corner).toBe('bottom-right')
    expect(logo.clearSpace).toBe(0.5)
    expect(logo.minHeight).toBe(24)
  })

  it('defaults a background entry to a cover fit and a 0.35 scrim', () => {
    const bg = BackgroundEntrySchema.parse({ file: 'backgrounds/card-dark.jpg' })
    expect(bg.fit).toBe('cover')
    expect(bg.scrim).toBe(0.35)
  })

  it('closes the lock enum to the known groups', () => {
    expect(LOCK_KEYS).toContain('variants.brand')
    expect(LOCK_KEYS).toContain('logo')
    expect(LOCK_KEYS).toContain('backgrounds')
  })

  it('migrates a v1 theme, mirroring its one logo into both slots', () => {
    const v1 = {
      id: 't1', createdAt: '2026-01-01T00:00:00.000Z', schemaVersion: 1,
      name: 'Acme', company: 'Acme', tagline: '', website: '',
      variants: {
        brand: { background: '#2e2310', heading: '#fbf3e2', body: '#e0cfa8', accent: '#e9b949' },
        light: { background: '#f7f3ea', heading: '#1c1a16', body: '#514b41', accent: '#1a5fb4' },
        dark: { background: '#171b22', heading: '#f4f6f9', body: '#c9cedb', accent: '#7ab5f0' }
      },
      fonts: { heading: { family: 'Newsreader Variable', files: [], source: 'builtin' }, body: { family: 'Geist Variable', files: [], source: 'builtin' } },
      logo: { file: 'logo.svg', corner: 'top-left', showOn: { recordings: true, slides: true } },
      overlays: { highlight: '#7ab5f0', caption: 'dark' }
    }
    const theme = ThemeSchema.parse(migrateTheme(v1))
    expect(theme.schemaVersion).toBe(2)
    expect(theme.logo?.light?.file).toBe('logo.svg')
    expect(theme.logo?.dark?.file).toBe('logo.svg')
    expect(theme.logo?.corner).toBe('top-left')
  })

  it('leaves a v1 theme with no logo logo-less', () => {
    const v1 = { schemaVersion: 1, name: 'No Logo',
      variants: { brand: { background: '#000000', heading: '#ffffff', body: '#cccccc', accent: '#7ab5f0' }, light: { background: '#ffffff', heading: '#000000', body: '#333333', accent: '#1a4bb8' }, dark: { background: '#111111', heading: '#ffffff', body: '#bbbbbb', accent: '#7ab5f0' } },
      fonts: { heading: { family: 'Newsreader Variable' }, body: { family: 'Geist Variable' } } }
    const migrated = migrateTheme(v1) as { logo?: unknown }
    expect(migrated.logo).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/main/themes/schema.test.ts`
Expected: FAIL — `THEME_SCHEMA_VERSION` is 1, `ThemeLogoSchema` has no `light`/`dark`, `migrateTheme`/`BackgroundEntrySchema`/`LOCK_KEYS` are not exported.

- [ ] **Step 3: Edit `schema.ts`**

Change the version:

```ts
export const THEME_SCHEMA_VERSION = 2
```

Add after `LOGO_CORNERS`:

```ts
export const LOGO_SLOTS = ['light', 'dark'] as const
export type LogoSlot = (typeof LOGO_SLOTS)[number]
```

Reshape `ThemeLogoSchema` (replace the single-`file` shape). Keep `corner`/`showOn` defaults as they were:

```ts
/** A logo for one kind of background. Relative to the theme's folder: `logos/light.svg`… */
const LogoFileSchema = z.object({ file: z.string() })

export const ThemeLogoSchema = z.object({
  /** For light backgrounds (dark ink). */
  light: LogoFileSchema.optional(),
  /** For dark backgrounds (light ink). */
  dark: LogoFileSchema.optional(),
  corner: z.enum(LOGO_CORNERS).default('bottom-right'),
  showOn: z.object({ recordings: z.boolean().default(true), slides: z.boolean().default(true) }).default({}),
  /** Multiples of the logo's height kept clear around it; a compliance warning, never a hard crop. */
  clearSpace: z.number().optional(),
  /** px; below this the logo is too small to show legibly — a compliance warning. */
  minHeight: z.number().optional()
})
```

Add the background, palette and lock schemas before `ThemeFields`:

```ts
export const BackgroundFitSchema = z.enum(['cover', 'contain', 'tile'])
export type BackgroundFit = z.infer<typeof BackgroundFitSchema>

/** One surface's background image. Stored verbatim; the scrim is a tint of the variant background over it. */
export const BackgroundEntrySchema = z.object({
  /** Relative to the theme's folder: `backgrounds/card-dark.jpg`… */
  file: z.string(),
  fit: BackgroundFitSchema.default('cover'),
  /** 0 clears nothing, 1 hides the image; the floor that keeps text readable is a compliance warning. */
  scrim: z.number().min(0).max(1).default(0.35)
})
export type BackgroundEntry = z.infer<typeof BackgroundEntrySchema>

const BackgroundContextSchema = z.object({
  brand: BackgroundEntrySchema.optional(),
  light: BackgroundEntrySchema.optional(),
  dark: BackgroundEntrySchema.optional()
})
/** Background imagery per surface. A diagram keeps its solid themed ground and is never here. */
export const ThemeBackgroundsSchema = z.object({
  card: BackgroundContextSchema.optional(),
  content: BackgroundContextSchema.optional()
})
export type ThemeBackgrounds = z.infer<typeof ThemeBackgroundsSchema>

export const PaletteColourSchema = z.object({ name: z.string(), hex: HexColourSchema })
export const BrandSchema = z.object({ palette: z.array(PaletteColourSchema).optional() })

export const LOCK_KEYS = [
  'variants.brand', 'variants.light', 'variants.dark',
  'fonts.heading', 'fonts.body', 'logo', 'backgrounds'
] as const
export type LockKey = (typeof LOCK_KEYS)[number]
export const LockKeySchema = z.enum(LOCK_KEYS)
```

Add the new fields to `ThemeFields` (after `logo`):

```ts
  logo: ThemeLogoSchema.optional(),
  backgrounds: ThemeBackgroundsSchema.optional(),
  brand: BrandSchema.optional(),
  /** Groups a person has frozen: automation (AI, contrast-fix) never moves them. */
  locks: z.array(LockKeySchema).optional(),
```

Add the inferred types alongside the others:

```ts
export type ThemeBackgroundEntry = z.infer<typeof BackgroundEntrySchema>
export type PaletteColour = z.infer<typeof PaletteColourSchema>
```

Add the migration helper at the end of the file:

```ts
/**
 * An older theme read as a v2 one. A v1 theme stored one logo for every background; v2 keeps a
 * light-ground and a dark-ground logo, so the one it had serves both until the editor or AI
 * fills them apart. Everything else is forward-compatible through zod defaults, so only the logo
 * needs moving. Applied before ThemeSchema.parse on the way in.
 */
export function migrateTheme(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const theme = raw as Record<string, unknown>
  const version = typeof theme.schemaVersion === 'number' ? theme.schemaVersion : 1
  if (version >= THEME_SCHEMA_VERSION) return raw
  const next = { ...theme, schemaVersion: THEME_SCHEMA_VERSION }
  const logo = theme.logo as { file?: string } | undefined
  if (logo && typeof logo.file === 'string' && !('light' in logo) && !('dark' in logo)) {
    const { file, ...rest } = logo
    next.logo = { ...rest, light: { file }, dark: { file } }
  }
  return next
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/main/themes/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: FAIL in several files that read `theme.logo.file`/`theme.logo.url` (themeApi, toRenderTheme, renderTheme, LogoMark, sceneThemeOf, MCP, editor). That is expected — Tasks 2–12 fix each. Note the list; do not fix here. If any failure is inside `schema.ts` itself, fix it now.

- [ ] **Step 6: Commit**

```bash
git add src/main/themes/schema.ts src/main/themes/schema.test.ts
git commit -m "Add the v2 theme schema: a logo pair, backgrounds, a palette and locks"
```

---

## Task 2: Storage — generalized asset writer for logos, backgrounds and fonts

**Files:**
- Modify: `src/main/themes/themeApi.ts`
- Test: `src/main/themes/themeApi.test.ts` (create if absent; otherwise add a describe block)

**Interfaces:**
- Consumes: `ThemeLogo`/`ThemeBackgrounds` from Task 1; existing `findThemeDir`, `themeDirOrThrow`, `MAX_LOGO_BYTES`.
- Produces:
  - `MAX_BACKGROUND_BYTES = 12 * 1024 * 1024`
  - `writeAssetInto(dir, kind, slot, fileName, bytes): string` where `kind: 'logo'|'background'|'font'` and `slot: string` (`'light'`/`'dark'` for a logo; `'card-dark'` etc. for a background; ignored for a font). Returns the path relative to the theme dir.
  - `writeThemeAsset(id, kind, slot, fileName, bytes, baseDir?): string` — same, resolving a saved theme's folder.

The logo now lives at `logos/<slot>.<ext>` and a background at `backgrounds/<slot>.<ext>`. Fonts are unchanged (`fonts/<name>`).

- [ ] **Step 1: Write failing tests**

Create `src/main/themes/themeApi.test.ts`:

```ts
import { mkdtempSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeAssetInto, MAX_BACKGROUND_BYTES } from './themeApi'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theme-assets-'))
  dirs.push(dir)
  return dir
}
afterEach(() => { /* temp dirs are cleaned by the OS; nothing to do between cases */ })

describe('writeAssetInto', () => {
  it('writes a logo slot into logos/ and names it for the slot', () => {
    const dir = tempDir()
    const path = writeAssetInto(dir, 'logo', 'light', 'brand-white.svg', Buffer.from('<svg/>'))
    expect(path).toBe('logos/light.svg')
    expect(existsSync(join(dir, 'logos/light.svg'))).toBe(true)
  })

  it('replaces the previous file in a logo slot rather than leaving both', () => {
    const dir = tempDir()
    writeAssetInto(dir, 'logo', 'dark', 'a.svg', Buffer.from('<svg/>'))
    writeAssetInto(dir, 'logo', 'dark', 'b.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const files = readdirSync(join(dir, 'logos'))
    expect(files).toEqual(['dark.png'])
  })

  it('writes a background slot into backgrounds/ verbatim', () => {
    const dir = tempDir()
    const bytes = Buffer.from('JPEGBYTES')
    const path = writeAssetInto(dir, 'background', 'card-dark', 'hero.jpg', bytes)
    expect(path).toBe('backgrounds/card-dark.jpg')
    expect(existsSync(join(dir, 'backgrounds/card-dark.jpg'))).toBe(true)
  })

  it('refuses a background that is not an image', () => {
    const dir = tempDir()
    expect(() => writeAssetInto(dir, 'background', 'card-dark', 'notes.txt', Buffer.from('x'))).toThrow()
  })

  it('refuses a background over the ceiling', () => {
    const dir = tempDir()
    const big = Buffer.alloc(MAX_BACKGROUND_BYTES + 1)
    expect(() => writeAssetInto(dir, 'background', 'content-light', 'huge.png', big)).toThrow()
  })

  it('still writes a font into fonts/', () => {
    const dir = tempDir()
    const path = writeAssetInto(dir, 'font', '', 'AcmeSans.otf', Buffer.from('OTTO'))
    expect(path).toBe('fonts/AcmeSans.otf')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/main/themes/themeApi.test.ts`
Expected: FAIL — `writeAssetInto` has the old `(dir, kind, fileName, bytes)` arity and no background support; `MAX_BACKGROUND_BYTES` is not exported.

- [ ] **Step 3: Edit `themeApi.ts`**

Add the ceiling and the background type set near `MAX_LOGO_BYTES`:

```ts
/** A background rides into every frame it is on as a data URL; past this the render drags. Warned, not shrunk. */
export const MAX_BACKGROUND_BYTES = 12 * 1024 * 1024

const IMAGE_TYPES = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])
```

Replace `writeAssetInto` with the slotted version (keep `.jpeg`→`.jpg` collapse, keep the per-slot "remove the old file first" rule that stopped a replaced logo leaving its predecessor behind):

```ts
export function writeAssetInto(
  dir: string,
  kind: 'logo' | 'background' | 'font',
  slot: string,
  fileName: string,
  bytes: Buffer
): string {
  mkdirSync(dir, { recursive: true })
  const extension = extname(fileName).toLowerCase()
  const ext = extension === '.jpeg' ? '.jpg' : extension

  if (kind === 'logo' || kind === 'background') {
    if (!IMAGE_TYPES.has(extension)) throw new Error('A logo or background has to be an SVG, PNG, JPEG or WebP image.')
    const ceiling = kind === 'logo' ? MAX_LOGO_BYTES : MAX_BACKGROUND_BYTES
    if (bytes.length > ceiling) {
      throw new Error(kind === 'logo' ? 'A logo has to be under 2 MB.' : 'A background has to be under 12 MB.')
    }
    const subdir = kind === 'logo' ? 'logos' : 'backgrounds'
    const into = join(dir, subdir)
    mkdirSync(into, { recursive: true })
    // One file to a slot, so replacing it cannot leave the old one behind to be picked up.
    for (const old of readdirSync(into).filter((name) => name.startsWith(`${slot}.`))) rmSync(join(into, old))
    const name = `${slot}${ext}`
    writeFileSync(join(into, name), bytes)
    return `${subdir}/${name}`
  }

  if (!FONT_TYPES.has(extension)) throw new Error('A font has to be a WOFF2, WOFF, TTF or OTF file.')
  mkdirSync(join(dir, 'fonts'), { recursive: true })
  const name = basename(fileName).replace(/[^\w.-]+/g, '-')
  writeFileSync(join(dir, 'fonts', name), bytes)
  return `fonts/${name}`
}
```

Update `writeThemeAsset` to carry the slot through:

```ts
export function writeThemeAsset(
  id: string,
  kind: 'logo' | 'background' | 'font',
  slot: string,
  fileName: string,
  bytes: Buffer,
  baseDir: string = homedir()
): string {
  return writeAssetInto(themeDirOrThrow(id, baseDir), kind, slot, fileName, bytes)
}
```

Update `addFontInto` (which calls `writeAssetInto`) to pass an empty slot:

```ts
export function addFontInto(dir: string, fileName: string, bytes: Buffer): ThemeFontFile {
  const info = readFontInfo(bytes)
  if (!info) throw new Error(`${basename(fileName)} is not a font Talkie can read. Use the .otf, .ttf, .woff or .woff2 files the company's font came in.`)
  return { file: writeAssetInto(dir, 'font', '', fileName, bytes), ...info }
}
```

Note: `generateTheme.ts` and `themeHandlers.ts` and `server.ts` also call `writeAssetInto`/`writeThemeAsset`; they are updated in Tasks 9/10/11. `LOGO_TYPES` may now be unused — if so, remove it; otherwise leave it. `duplicateTheme` already copies every folder entry except `theme.json` recursively, so `logos/` and `backgrounds/` are carried with no change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/main/themes/themeApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/themes/themeApi.ts src/main/themes/themeApi.test.ts
git commit -m "Store logo slots and background images in the theme folder, verbatim"
```

---

## Task 3: Render-theme — read the logo pair and backgrounds into data URLs; stamp them

**Files:**
- Modify: `src/composition/renderTheme.ts` (the `RenderTheme` type + `themeStamp`)
- Modify: `src/main/themes/toRenderTheme.ts`
- Test: `src/main/themes/toRenderTheme.test.ts` (create if absent)

**Interfaces:**
- Consumes: Task 1 schema types; `readInside`, `dataUrl`, `stillLogo`, `MAX_FONT_BYTES`.
- Produces on `RenderTheme`:
  - `logo?: { light?: string; dark?: string; corner: LogoCorner; showOn: {...}; clearSpace?: number; minHeight?: number }` (data URLs per slot)
  - `backgrounds?: { card?: Partial<Record<VariantId, { url: string; fit: BackgroundFit; scrim: number }>>; content?: ... }`
  - `brand?: { palette?: { name: string; hex: string }[] }`
  - `locks?: LockKey[]`
  - `warnings?: string[]` — assets dropped for exceeding the inline ceiling.
- `themeStamp` folds in logo + background slot paths.

- [ ] **Step 1: Write failing tests**

Create `src/main/themes/toRenderTheme.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { renderThemeFrom } from './toRenderTheme'
import { ThemeDraftSchema } from './schema'

function themeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'render-theme-'))
  mkdirSync(join(dir, 'logos'), { recursive: true })
  mkdirSync(join(dir, 'backgrounds'), { recursive: true })
  return dir
}

const base = {
  name: 'Acme',
  variants: {
    brand: { background: '#2e2310', heading: '#fbf3e2', body: '#e0cfa8', accent: '#e9b949' },
    light: { background: '#f7f3ea', heading: '#1c1a16', body: '#514b41', accent: '#1a5fb4' },
    dark: { background: '#171b22', heading: '#f4f6f9', body: '#c9cedb', accent: '#7ab5f0' }
  },
  fonts: { heading: { family: 'Newsreader Variable', source: 'builtin' as const }, body: { family: 'Geist Variable', source: 'builtin' as const } }
}

describe('renderThemeFrom with v2 assets', () => {
  it('reads each logo slot into its own data URL', () => {
    const dir = themeDir()
    writeFileSync(join(dir, 'logos/light.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    writeFileSync(join(dir, 'logos/dark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const draft = ThemeDraftSchema.parse({ ...base, logo: { light: { file: 'logos/light.svg' }, dark: { file: 'logos/dark.svg' } } })
    const rendered = renderThemeFrom(draft, dir)
    expect(rendered.logo?.light?.startsWith('data:image/svg+xml')).toBe(true)
    expect(rendered.logo?.dark?.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('reads a background slot into a data URL with its fit and scrim', () => {
    const dir = themeDir()
    writeFileSync(join(dir, 'backgrounds/card-dark.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const draft = ThemeDraftSchema.parse({ ...base, backgrounds: { card: { dark: { file: 'backgrounds/card-dark.png', fit: 'cover', scrim: 0.4 } } } })
    const rendered = renderThemeFrom(draft, dir)
    expect(rendered.backgrounds?.card?.dark?.url.startsWith('data:image/png')).toBe(true)
    expect(rendered.backgrounds?.card?.dark?.scrim).toBe(0.4)
    expect(rendered.backgrounds?.card?.dark?.fit).toBe('cover')
  })

  it('drops a background over the inline ceiling and warns rather than shrinking it', () => {
    const dir = themeDir()
    writeFileSync(join(dir, 'backgrounds/content-light.png'), Buffer.alloc(13 * 1024 * 1024))
    const draft = ThemeDraftSchema.parse({ ...base, backgrounds: { content: { light: { file: 'backgrounds/content-light.png' } } } })
    const rendered = renderThemeFrom(draft, dir)
    expect(rendered.backgrounds?.content?.light).toBeUndefined()
    expect(rendered.warnings?.some((w) => /content-light/.test(w) || /too large/i.test(w))).toBe(true)
  })

  it('changes the stamp when a background is added', () => {
    const dir = themeDir()
    const bare = ThemeDraftSchema.parse(base)
    writeFileSync(join(dir, 'backgrounds/card-dark.png'), Buffer.from([0x89]))
    const withBg = ThemeDraftSchema.parse({ ...base, backgrounds: { card: { dark: { file: 'backgrounds/card-dark.png' } } } })
    expect(renderThemeFrom(bare, dir).stamp).not.toBe(renderThemeFrom(withBg, dir).stamp)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/main/themes/toRenderTheme.test.ts`
Expected: FAIL — `renderThemeFrom` still builds a single-`url` logo and no backgrounds; `warnings` absent.

- [ ] **Step 3: Edit `renderTheme.ts`**

Import the new types and reshape `RenderTheme`:

```ts
import type { BackgroundFit, LockKey, LogoCorner, Theme, Variant, VariantId } from '../main/themes/schema'

export interface RenderTheme {
  stamp: string
  company: string
  tagline: string
  website: string
  variants: Record<VariantId, Variant>
  fonts: {
    heading: { family: string; urls: string[] }
    body: { family: string; urls: string[] }
  }
  logo?: {
    light?: string
    dark?: string
    corner: LogoCorner
    showOn: { recordings: boolean; slides: boolean }
    clearSpace?: number
    minHeight?: number
  }
  backgrounds?: {
    card?: Partial<Record<VariantId, { url: string; fit: BackgroundFit; scrim: number }>>
    content?: Partial<Record<VariantId, { url: string; fit: BackgroundFit; scrim: number }>>
  }
  brand?: { palette?: { name: string; hex: string }[] }
  locks?: LockKey[]
  /** Assets left out of the render because they were too large to inline — surfaced by the compliance check. */
  warnings?: string[]
  caption: VariantId
}
```

Extend `themeStamp` to fold in logo + background paths (so swapping an image invalidates cached diagrams/posters). It takes `Pick<Theme,'variants'|'fonts'>` today; widen it:

```ts
export function themeStamp(theme: Pick<Theme, 'variants' | 'fonts'> & Pick<Partial<Theme>, 'logo' | 'backgrounds'>): string {
  const logoPaths = theme.logo ? [theme.logo.light?.file ?? '', theme.logo.dark?.file ?? ''] : []
  const bgPaths = theme.backgrounds
    ? (['card', 'content'] as const).flatMap((ctx) =>
        (['brand', 'light', 'dark'] as const).map((v) => theme.backgrounds?.[ctx]?.[v]?.file ?? ''))
    : []
  const text = JSON.stringify([theme.variants, theme.fonts.heading.family, theme.fonts.body.family, logoPaths, bgPaths])
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
```

- [ ] **Step 4: Edit `toRenderTheme.ts`**

Add `import { MAX_BACKGROUND_BYTES } from './themeApi'` and `import type { VariantId } from './schema'`. Replace the logo-building block (lines ~76–96) and add background building. The SVG `stillLogo` pass applies per slot:

```ts
  const warnings: string[] = []

  const logoSlot = (file: string | undefined): string | undefined => {
    if (!file || !dir) return undefined
    const stored = readInside(dir, file)
    if (!stored) return undefined
    const bytes = extname(file).toLowerCase() === '.svg' ? Buffer.from(stillLogo(stored.toString('utf-8'))) : stored
    return dataUrl(bytes, file)
  }

  const logo =
    draft.logo && dir && (draft.logo.light || draft.logo.dark)
      ? {
          ...(logoSlot(draft.logo.light?.file) ? { light: logoSlot(draft.logo.light?.file) } : {}),
          ...(logoSlot(draft.logo.dark?.file) ? { dark: logoSlot(draft.logo.dark?.file) } : {}),
          corner: draft.logo.corner,
          showOn: draft.logo.showOn,
          ...(draft.logo.clearSpace !== undefined ? { clearSpace: draft.logo.clearSpace } : {}),
          ...(draft.logo.minHeight !== undefined ? { minHeight: draft.logo.minHeight } : {})
        }
      : undefined

  const background = (entry: { file: string; fit: BackgroundFit; scrim: number } | undefined, label: string) => {
    if (!entry || !dir) return undefined
    const bytes = readInside(dir, entry.file)
    if (!bytes) return undefined
    if (bytes.length > MAX_BACKGROUND_BYTES) {
      warnings.push(`The background ${label} (${entry.file}) is too large to show (over 12 MB), so it was left off. Save a smaller file.`)
      return undefined
    }
    return { url: dataUrl(bytes, entry.file), fit: entry.fit, scrim: entry.scrim }
  }

  const backgroundsFor = (ctx: 'card' | 'content') => {
    const group = draft.backgrounds?.[ctx]
    if (!group) return undefined
    const out: Partial<Record<VariantId, { url: string; fit: BackgroundFit; scrim: number }>> = {}
    for (const v of ['brand', 'light', 'dark'] as const) {
      const built = background(group[v], `${ctx} ${v}`)
      if (built) out[v] = built
    }
    return Object.keys(out).length ? out : undefined
  }

  const backgrounds =
    draft.backgrounds && dir
      ? (() => {
          const card = backgroundsFor('card')
          const content = backgroundsFor('content')
          return card || content ? { ...(card ? { card } : {}), ...(content ? { content } : {}) } : undefined
        })()
      : undefined
```

Import `BackgroundFit`: add it to the `import type { ... } from './schema'` line. Then build the returned object (replace the current `return { ... }`):

```ts
  return {
    stamp: themeStamp(draft),
    company: draft.company,
    tagline: draft.tagline,
    website: draft.website,
    variants: draft.variants,
    fonts: {
      heading: font(draft.fonts.heading, BUILTIN_FONTS.serif),
      body: font(draft.fonts.body, BUILTIN_FONTS.sans)
    },
    ...(logo ? { logo } : {}),
    ...(backgrounds ? { backgrounds } : {}),
    ...(draft.brand ? { brand: draft.brand } : {}),
    ...(draft.locks ? { locks: draft.locks } : {}),
    ...(warnings.length ? { warnings } : {}),
    caption: draft.overlays.caption
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/main/themes/toRenderTheme.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/composition/renderTheme.ts src/main/themes/toRenderTheme.ts src/main/themes/toRenderTheme.test.ts
git commit -m "Build the v2 render theme: logo slots, backgrounds and a size ceiling that warns"
```

---

## Task 4: Composition — pick the logo by surface luminance

**Files:**
- Modify: `src/composition/renderTheme.ts` (add `logoUrlFor`)
- Modify: `src/composition/LogoMark.tsx`
- Modify: `src/composition/LogoOverlay.tsx`
- Modify: `src/htmlScene/protocol.ts` (`sceneThemeOf` resolves one logo URL)
- Test: `src/composition/renderTheme.test.ts` (create; test `logoUrlFor`)

**Interfaces:**
- Consumes: `RenderTheme` v2 (Task 3); `luminance` from `../main/themes/contrast`.
- Produces: `logoUrlFor(theme: RenderTheme, surfaceBackgroundHex: string | undefined): string | undefined` — returns the dark-ground logo on a dark surface and the light-ground logo on a light surface, falling back to whichever slot exists. With no surface known (over a recording), prefers `dark` then `light`.

- [ ] **Step 1: Write failing test**

Create `src/composition/renderTheme.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { logoUrlFor, type RenderTheme } from './renderTheme'

const theme = (logo: RenderTheme['logo']): RenderTheme => ({
  stamp: '0', company: '', tagline: '', website: '',
  variants: {
    brand: { background: '#2e2310', heading: '#fff', body: '#eee', accent: '#e9b949' },
    light: { background: '#ffffff', heading: '#000', body: '#333', accent: '#1a4bb8' },
    dark: { background: '#111111', heading: '#fff', body: '#ccc', accent: '#7ab5f0' }
  },
  fonts: { heading: { family: 'x', urls: [] }, body: { family: 'y', urls: [] } },
  logo, caption: 'dark'
})

describe('logoUrlFor', () => {
  const both = theme({ light: 'data:light', dark: 'data:dark', corner: 'bottom-right', showOn: { recordings: true, slides: true } })

  it('uses the dark-ground logo on a dark surface', () => {
    expect(logoUrlFor(both, '#111111')).toBe('data:dark')
  })
  it('uses the light-ground logo on a light surface', () => {
    expect(logoUrlFor(both, '#ffffff')).toBe('data:light')
  })
  it('falls back to the only slot that exists', () => {
    const onlyLight = theme({ light: 'data:light', corner: 'bottom-right', showOn: { recordings: true, slides: true } })
    expect(logoUrlFor(onlyLight, '#111111')).toBe('data:light')
  })
  it('prefers the dark-ground logo when the surface is unknown', () => {
    expect(logoUrlFor(both, undefined)).toBe('data:dark')
  })
  it('is undefined when there is no logo', () => {
    expect(logoUrlFor(theme(undefined), '#111111')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/composition/renderTheme.test.ts`
Expected: FAIL — `logoUrlFor` is not exported.

- [ ] **Step 3: Add `logoUrlFor` to `renderTheme.ts`**

```ts
import { luminance } from '../main/themes/contrast'

/**
 * The logo to show on a surface: the dark-ground one on a dark background, the light-ground one
 * on a light background. Resolved here, on the composition's side, so an HTML scene is still
 * handed a single logo URL and its sandbox need know nothing of the pair. A surface is dark when
 * its luminance is below the same 0.18 the contrast fixer uses to decide which way to move text.
 */
export function logoUrlFor(theme: RenderTheme, surfaceBackgroundHex: string | undefined): string | undefined {
  const logo = theme.logo
  if (!logo) return undefined
  const wantsDark = surfaceBackgroundHex === undefined ? true : luminance(surfaceBackgroundHex) <= 0.18
  const first = wantsDark ? logo.dark : logo.light
  const second = wantsDark ? logo.light : logo.dark
  return first ?? second
}
```

Note: `luminance` takes a `#rrggbb` string. A variant background is always a hex; if a caller ever passes a gradient (unthemed), guard by trying the hex regex — but themed surfaces are always hex, so this is safe here.

- [ ] **Step 4: Update `LogoMark.tsx`**

`LogoMark` currently reads `theme.logo.url`. Change its prop to take a resolved `url` directly rather than reaching into `theme.logo`, so it does not need the pair:

Change the signature so the caller passes the chosen URL:

```tsx
export function LogoMark({
  theme,
  url,
  height,
  maxWidth,
  background
}: {
  theme: RenderTheme
  url: string
  height: number
  maxWidth: number
  background?: string
}): JSX.Element {
  const [colours, setColours] = useState<LogoColours | null | undefined>(undefined)
  // ...unchanged, but every `theme.logo.url` becomes `url`
```

Replace `const url = theme.logo.url` with the `url` prop (delete that line), and the `readLogoColours(url)` / `logoPlate(colours ?? null, background, theme)` calls stay as they are.

- [ ] **Step 5: Update `LogoOverlay.tsx`**

Resolve the URL with `logoUrlFor` using the slide background, and pass it in:

```tsx
import { useRenderTheme, logoUrlFor, type RenderTheme } from './renderTheme'
// ...
export function LogoOverlay({ kind, data }: { kind: string; data: unknown }): JSX.Element | null {
  const theme = useRenderTheme()
  const { width, height } = useVideoConfig()
  const placement = logoPlacement(kind, data, theme)
  if (!placement || !theme?.logo) return null

  const isSlide = kind === 'scene' || kind === 'diagram' || kind === 'html'
  const background = isSlide ? resolveSceneTheme((data as { style?: SceneStyle } | null)?.style, theme).background : undefined
  const url = logoUrlFor(theme, background)
  if (!url) return null

  return (
    <div style={{ position: 'absolute', ...placement, pointerEvents: 'none' }}>
      <LogoMark theme={theme} url={url} height={Math.round(height * 0.06)} maxWidth={Math.round(width * 0.18)} background={background} />
    </div>
  )
}
```

`logoPlacement` reads only `theme.logo.corner`/`showOn`, which still exist — leave it unchanged.

- [ ] **Step 6: Update `sceneThemeOf` in `protocol.ts`**

`sceneThemeOf(theme, variant)` builds the `SceneTheme` a scene/card receives. Resolve the logo for that variant's background so `SceneTheme.logo` stays one URL:

```ts
import { plateGrounds } from '../composition/logoLegibility'
import { logoUrlFor } from '../composition/renderTheme'
// ...
export function sceneThemeOf(theme: RenderTheme | null, variant: 'brand' | 'light' | 'dark'): SceneTheme {
  if (!theme) return DEFAULT_SCENE_THEMES[variant]
  const logo = logoUrlFor(theme, theme.variants[variant].background)
  return {
    ...theme.variants[variant],
    fonts: theme.fonts,
    ...(logo ? { logo, plates: plateGrounds(theme) } : {}),
    ...(theme.company ? { company: theme.company } : {}),
    ...(theme.tagline ? { tagline: theme.tagline } : {}),
    ...(theme.website ? { website: theme.website } : {})
  }
}
```

`plateGrounds(theme)` reads `theme.variants.light.background` / `theme.variants.dark.background`, which are unchanged — leave it.

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test -- src/composition/renderTheme.test.ts` → PASS.
Run: `npm run typecheck`
Expected: the Task-1 logo errors in these three files are now resolved. Remaining errors should be only in Task 5/6 (TextScene, runtime), the editor, MCP, generate, IPC — not in LogoMark/LogoOverlay/protocol/renderTheme. Fix any stray reference to `theme.logo.url` you introduced.

- [ ] **Step 8: Commit**

```bash
git add src/composition/renderTheme.ts src/composition/renderTheme.test.ts src/composition/LogoMark.tsx src/composition/LogoOverlay.tsx src/htmlScene/protocol.ts
git commit -m "Pick the logo by the surface it sits on, resolved before a scene sees it"
```

---

## Task 5: Composition — paint a background image and scrim under native scenes

**Files:**
- Create: `src/composition/backgroundFor.ts`
- Create: `src/composition/backgroundFor.test.ts`
- Modify: `src/composition/items/TextScene.tsx`

**Interfaces:**
- Consumes: `RenderTheme` v2; `VARIANT_FOR` from `sceneTheme`.
- Produces: `backgroundFor(theme, context, variant): { url: string; fit: BackgroundFit; scrim: number } | undefined`, where `context: 'card' | 'content'`.

A card scene is one the theme added (opening/closing) or a title/closing layout; everything else is `content`. `TextScene` already knows whether it is drawing a `Card`; pass the context from there.

- [ ] **Step 1: Write failing test**

Create `src/composition/backgroundFor.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { backgroundFor } from './backgroundFor'
import type { RenderTheme } from './renderTheme'

const theme: RenderTheme = {
  stamp: '0', company: '', tagline: '', website: '',
  variants: {
    brand: { background: '#2e2310', heading: '#fff', body: '#eee', accent: '#e9b949' },
    light: { background: '#fff', heading: '#000', body: '#333', accent: '#1a4bb8' },
    dark: { background: '#111', heading: '#fff', body: '#ccc', accent: '#7ab5f0' }
  },
  fonts: { heading: { family: 'x', urls: [] }, body: { family: 'y', urls: [] } },
  backgrounds: { content: { dark: { url: 'data:bg', fit: 'cover', scrim: 0.5 } } },
  caption: 'dark'
}

describe('backgroundFor', () => {
  it('returns the entry for a context and variant', () => {
    expect(backgroundFor(theme, 'content', 'dark')).toEqual({ url: 'data:bg', fit: 'cover', scrim: 0.5 })
  })
  it('is undefined for a context with no image', () => {
    expect(backgroundFor(theme, 'card', 'dark')).toBeUndefined()
  })
  it('is undefined for a theme with no backgrounds', () => {
    expect(backgroundFor({ ...theme, backgrounds: undefined }, 'content', 'dark')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/composition/backgroundFor.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `backgroundFor.ts`**

```ts
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
```

- [ ] **Step 4: Paint it in `TextScene.tsx`**

`TextScene` wraps content in `<Fill style={{ background: theme.background }}>`. Add an image layer and a scrim between the solid fill and the content, so the paint order is solid → image → scrim → content. Add a small helper component in the file:

```tsx
import { backgroundFor } from '../backgroundFor'
import { VARIANT_FOR } from '../sceneTheme'
// (project = useRenderTheme() is already in scope as the RenderTheme)

/** The background image and its scrim, between a scene's solid ground and its content. */
function BackgroundLayers({
  theme,
  context,
  variant,
  scrimColour
}: {
  theme: RenderTheme | null
  context: 'card' | 'content'
  variant: VariantId
  scrimColour: string
}): JSX.Element | null {
  const bg = backgroundFor(theme, context, variant)
  if (!bg) return null
  const image: React.CSSProperties =
    bg.fit === 'tile'
      ? { backgroundImage: `url("${bg.url}")`, backgroundRepeat: 'repeat', backgroundSize: 'auto' }
      : { backgroundImage: `url("${bg.url}")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'center', backgroundSize: bg.fit }
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, ...image, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, background: scrimColour, opacity: bg.scrim, pointerEvents: 'none' }} />
    </>
  )
}
```

In the standard-slide `<Fill>` (the one at `background: theme.background`), insert `<BackgroundLayers .../>` as the first child so it sits under the text. The variant is `VARIANT_FOR[style?.theme ?? 'dark']`; the scrim colour is the variant background (`theme.background`, the resolved one). Content context is `'content'`:

```tsx
const variant = VARIANT_FOR[style?.theme ?? 'dark'] ?? 'dark'
// inside the standard <Fill style={{ background: theme.background, ... }}>:
<BackgroundLayers theme={project} context="content" variant={variant} scrimColour={theme.background} />
{/* existing children follow */}
```

For the `Card` sub-component (opening/closing cards), do the same with `context="card"`. `Card` receives `look: ResolvedSceneTheme`; pass the `project` theme and the variant through to it (add props) and render `<BackgroundLayers theme={project} context="card" variant={variant} scrimColour={look.background} />` as the first child of its `<Fill>`.

Because `<Fill>` is `position: relative`-like full-bleed (it is the base container) the absolutely-positioned layers fill it; the existing content must sit above them. If the content is not already positioned, wrap the existing children in a `<div style={{ position: 'relative' }}>` so they stack above the scrim. Keep this minimal — do not restructure the layout.

- [ ] **Step 5: Verify preview/export still render (manual + tests)**

Run: `npm test -- src/composition`
Expected: existing composition tests pass; new `backgroundFor.test.ts` passes. If a snapshot or render test exists for `TextScene`, confirm it still matches (a theme with no backgrounds renders exactly as before — `BackgroundLayers` returns null).

- [ ] **Step 6: Commit**

```bash
git add src/composition/backgroundFor.ts src/composition/backgroundFor.test.ts src/composition/items/TextScene.tsx
git commit -m "Paint a theme's background image and scrim under native scene content"
```

---

## Task 6: HTML scenes — hand the background to the runtime without touching the sandbox

**Files:**
- Modify: `src/htmlScene/protocol.ts` (`SceneTheme` carries a resolved background; `sceneThemeOf` sets it)
- Modify: `src/htmlScene/runtime/theme.ts` (set CSS vars + inject the layer)
- Test: `src/htmlScene/runtime/theme.test.ts` (create if absent; else nearest runtime test)

**Interfaces:**
- Consumes: `RenderTheme.backgrounds`; `VARIANT_FOR`.
- Produces on `SceneTheme`: `background Image?: { url: string; fit: BackgroundFit; scrim: number }` (name it `bgImage` to avoid clashing with the existing `background` colour field). `sceneThemeOf` resolves it for the variant, context `'card'` when the scene is a card else `'content'` — but `sceneThemeOf` does not currently know the context. Add a third argument `context: 'card' | 'content' = 'content'` and have the card path pass `'card'`.

- [ ] **Step 1: Write failing test**

Create `src/htmlScene/runtime/theme.test.ts` (jsdom):

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyTheme } from './theme'
import type { SceneTheme } from '../protocol'

const base: SceneTheme = {
  background: '#111111', heading: '#ffffff', body: '#cccccc', accent: '#7ab5f0',
  fonts: { heading: { family: 'Geist Variable', urls: [] }, body: { family: 'Geist Variable', urls: [] } }
}

describe('applyTheme backgrounds', () => {
  it('sets the background-image CSS variables when the scene has one', async () => {
    const doc = document.implementation.createHTMLDocument('t')
    await applyTheme(doc, { ...base, bgImage: { url: 'data:bg', fit: 'cover', scrim: 0.4 } }, '/__talkie')
    const root = doc.documentElement.style
    expect(root.getPropertyValue('--talkie-bg-image')).toContain('data:bg')
    expect(root.getPropertyValue('--talkie-bg-fit')).toBe('cover')
    expect(root.getPropertyValue('--talkie-bg-scrim')).toBe('0.4')
  })

  it('leaves the variables empty when the scene has no background image', async () => {
    const doc = document.implementation.createHTMLDocument('t')
    await applyTheme(doc, base, '/__talkie')
    expect(doc.documentElement.style.getPropertyValue('--talkie-bg-image')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/htmlScene/runtime/theme.test.ts`
Expected: FAIL — `applyTheme` sets no `--talkie-bg-*` variables; `SceneTheme` has no `bgImage`.

- [ ] **Step 3: Extend `SceneTheme` and `sceneThemeOf` in `protocol.ts`**

Add to the `SceneTheme` interface:

```ts
  /** The background image behind this scene, with its fit and scrim; absent for a scene with none. */
  bgImage?: { url: string; fit: 'cover' | 'contain' | 'tile'; scrim: number }
```

Change `sceneThemeOf` to take the context and resolve the background:

```ts
import { backgroundFor } from '../composition/backgroundFor'
// ...
export function sceneThemeOf(theme: RenderTheme | null, variant: 'brand' | 'light' | 'dark', context: 'card' | 'content' = 'content'): SceneTheme {
  if (!theme) return DEFAULT_SCENE_THEMES[variant]
  const logo = logoUrlFor(theme, theme.variants[variant].background)
  const bgImage = backgroundFor(theme, context, variant)
  return {
    ...theme.variants[variant],
    fonts: theme.fonts,
    ...(logo ? { logo, plates: plateGrounds(theme) } : {}),
    ...(bgImage ? { bgImage } : {}),
    ...(theme.company ? { company: theme.company } : {}),
    ...(theme.tagline ? { tagline: theme.tagline } : {}),
    ...(theme.website ? { website: theme.website } : {})
  }
}
```

Find callers of `sceneThemeOf` (grep): the opening/closing card host must pass `'card'`. Search `src/main/htmlScene` and `src/composition` for `sceneThemeOf(` and pass `'card'` where a card is being drawn. If the caller cannot tell, default `'content'` is safe (a card simply gets no background unless one is set for `card`).

- [ ] **Step 4: Set the variables and inject the layer in `runtime/theme.ts`**

After the existing `--talkie-logo-plate` line, add:

```ts
  if (theme.bgImage) {
    root.setProperty('--talkie-bg-image', `url("${theme.bgImage.url}")`)
    root.setProperty('--talkie-bg-fit', theme.bgImage.fit)
    root.setProperty('--talkie-bg-scrim', String(theme.bgImage.scrim))
    injectBackgroundLayer(doc, theme)
  }
```

Add the injector (a fixed, pointer-events-none layer behind everything; it paints solid → image → scrim, matching the native order — the solid is the scene's own `--talkie-bg`):

```ts
/**
 * A full-bleed layer behind the page carrying the theme's background image and its scrim, so a
 * scene written against the theme variables gets the imagery without the template knowing of it.
 * Served from the theme's own folder as a data URL, so connect-src 'none' is untouched.
 */
function injectBackgroundLayer(doc: Document, theme: SceneTheme): void {
  const id = '__talkie-bg'
  if (doc.getElementById(id) || !theme.bgImage) return
  const fit = theme.bgImage.fit
  const layer = doc.createElement('div')
  layer.id = id
  layer.setAttribute('aria-hidden', 'true')
  const size = fit === 'tile' ? 'background-repeat:repeat;background-size:auto' : `background-repeat:no-repeat;background-position:center;background-size:${fit}`
  layer.style.cssText = `position:fixed;inset:0;z-index:-1;pointer-events:none;background-color:${theme.background};`
  const image = doc.createElement('div')
  image.style.cssText = `position:absolute;inset:0;background-image:var(--talkie-bg-image);${size}`
  const scrim = doc.createElement('div')
  scrim.style.cssText = `position:absolute;inset:0;background:${theme.background};opacity:${theme.bgImage.scrim}`
  layer.append(image, scrim)
  ;(doc.body ?? doc.documentElement).prepend(layer)
}
```

Note `z-index:-1` with a `position:fixed` layer sits behind normal content; if a template sets its own background on `body`, that would cover this layer — acceptable, since a template that paints its own ground has opted out. Keep the injector idempotent (the `getElementById` guard), because `applyTheme` runs again on a `talkie:theme` message.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/htmlScene/runtime/theme.test.ts`
Expected: PASS. Also run `npm test -- src/htmlScene` to confirm `check.test.ts` and protocol tests still pass (the sandbox attributes are unchanged; a scene with no `bgImage` is byte-identical to before).

- [ ] **Step 6: Commit**

```bash
git add src/htmlScene/protocol.ts src/htmlScene/runtime/theme.ts src/htmlScene/runtime/theme.test.ts
git commit -m "Give HTML scenes a themed background layer through CSS variables, sandbox untouched"
```

---

## Task 7: Contrast — skip locked variants and report what it could not fix

**Files:**
- Modify: `src/main/themes/contrast.ts`
- Test: `src/main/themes/contrast.test.ts`

**Interfaces:**
- Consumes: `ThemeDraft`, `VariantId`, `LockKey`.
- Produces: `fixContrast(draft: ThemeDraft, locks?: LockKey[]): { draft: ThemeDraft; notes: string[]; unresolved: string[] }`. A locked variant (`variants.<id>` in `locks`) is left exactly as it is; any of its roles still below the floor is pushed to `unresolved` as a message, not changed. Backward compatible: called with no `locks`, `unresolved` is `[]` and behaviour is as today.

- [ ] **Step 1: Write failing tests**

Add to `src/main/themes/contrast.test.ts`:

```ts
import { fixContrast } from './contrast'
import { defaultThemeDraft } from './schema'

describe('fixContrast with locks', () => {
  const unreadable = () => {
    const draft = defaultThemeDraft('T')
    // body #777 on white dark-variant… force a known-bad pairing on the light variant:
    draft.variants.light = { background: '#ffffff', heading: '#eeeeee', body: '#dddddd', accent: '#eeeeee' }
    return draft
  }

  it('fixes an unlocked variant as before', () => {
    const { draft, unresolved } = fixContrast(unreadable())
    expect(draft.variants.light.body).not.toBe('#dddddd')
    expect(unresolved).toEqual([])
  })

  it('leaves a locked variant untouched and reports it as unresolved', () => {
    const { draft, unresolved } = fixContrast(unreadable(), ['variants.light'])
    expect(draft.variants.light.body).toBe('#dddddd')
    expect(unresolved.some((u) => /light/.test(u))).toBe(true)
  })

  it('still returns unresolved as empty when nothing is locked', () => {
    expect(fixContrast(defaultThemeDraft('T')).unresolved).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/main/themes/contrast.test.ts`
Expected: FAIL — `fixContrast` takes one argument and returns no `unresolved`.

- [ ] **Step 3: Edit `fixContrast` in `contrast.ts`**

```ts
import type { ThemeDraft, VariantId, LockKey } from './schema'
// ...
export function fixContrast(draft: ThemeDraft, locks: LockKey[] = []): { draft: ThemeDraft; notes: string[]; unresolved: string[] } {
  const notes: string[] = []
  const unresolved: string[] = []
  const variants = { ...draft.variants }

  for (const id of VARIANT_IDS as readonly VariantId[]) {
    const locked = locks.includes(`variants.${id}` as LockKey)
    const variant = { ...variants[id] }
    for (const role of ['heading', 'body', 'accent'] as const) {
      const before = variant[role]
      const after = readableAgainst(before, variant.background, MINIMUM[role])
      if (after === before) continue
      if (locked) {
        unresolved.push(`${id} ${role} (${before}) is hard to read on ${variant.background}, but ${id} is locked, so it was left as it is.`)
        continue
      }
      variant[role] = after
      notes.push(`${id} ${role}: ${before} was hard to read on ${variant.background}, so it was changed to ${after}.`)
    }
    variants[id] = variant
  }

  return notes.length === 0 ? { draft, notes, unresolved } : { draft: { ...draft, variants }, notes, unresolved }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/main/themes/contrast.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix callers' destructuring**

`fixContrast` is called in `generateTheme.ts` (`const readable = fixContrast(fonts.draft)`) and `server.ts` (`const fixed = fixContrast(...)`). Both read `.draft` and `.notes`; the added `.unresolved` does not break them. Run `npm run typecheck` to confirm no caller destructured positionally in a way that breaks. (It returns an object, so they are safe.) Tasks 9 and 11 will *use* `unresolved`.

- [ ] **Step 6: Commit**

```bash
git add src/main/themes/contrast.ts src/main/themes/contrast.test.ts
git commit -m "Let the contrast fix skip a locked variant and report what it left"
```

---

## Task 8: Compliance — a pure, warn-only brand check

**Files:**
- Create: `src/main/themes/compliance.ts`
- Create: `src/main/themes/compliance.test.ts`

**Interfaces:**
- Consumes: `Theme` (or `ThemeDraft` — accept the shared fields), `contrastRatio`, `luminance` from `contrast.ts`.
- Produces: `checkCompliance(theme): ComplianceWarning[]` where `ComplianceWarning = { severity: 'warn'; group: LockKey | 'logo' | 'backgrounds'; message: string }`. Checks: contrast floors per variant; scrim below 0.3 on a text-bearing background; off-palette variant colours when `brand.palette` is set; a missing counterpart logo. Logo clear-space/min-height are advisory strings when the fields are set (they cannot be fully verified without a layout, so warn only if the value is implausible, e.g. `minHeight` larger than a corner logo's rendered height ~ 6% of 1080 = 65px → warn if `minHeight > 65`). Returns `[]` for a clean theme.

- [ ] **Step 1: Write failing tests**

Create `src/main/themes/compliance.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkCompliance } from './compliance'
import { defaultThemeDraft } from './schema'

function theme(overrides: Record<string, unknown> = {}) {
  return { id: 't', createdAt: '2026-01-01T00:00:00.000Z', schemaVersion: 2, ...defaultThemeDraft('T'), ...overrides } as never
}

describe('checkCompliance', () => {
  it('is clean for a default theme', () => {
    expect(checkCompliance(theme())).toEqual([])
  })

  it('warns when body text fails contrast on its background', () => {
    const t = theme({ variants: { ...defaultThemeDraft('T').variants, light: { background: '#ffffff', heading: '#eeeeee', body: '#dddddd', accent: '#eeeeee' } } })
    const warnings = checkCompliance(t)
    expect(warnings.some((w) => w.group === 'variants.light' && /read/i.test(w.message))).toBe(true)
  })

  it('warns about a low scrim over a background', () => {
    const t = theme({ backgrounds: { content: { dark: { file: 'backgrounds/content-dark.jpg', fit: 'cover', scrim: 0.1 } } } })
    expect(checkCompliance(t).some((w) => w.group === 'backgrounds' && /scrim|read/i.test(w.message))).toBe(true)
  })

  it('warns about an off-palette colour', () => {
    const t = theme({ brand: { palette: [{ name: 'Ink', hex: '#0b1f3a' }] }, variants: { ...defaultThemeDraft('T').variants, brand: { background: '#2e2310', heading: '#fbf3e2', body: '#e0cfa8', accent: '#ff00ff' } } })
    expect(checkCompliance(t).some((w) => /palette/i.test(w.message))).toBe(true)
  })

  it('warns when only one logo slot is filled', () => {
    const t = theme({ logo: { light: { file: 'logos/light.svg' }, corner: 'bottom-right', showOn: { recordings: true, slides: true } } })
    expect(checkCompliance(t).some((w) => w.group === 'logo' && /dark|background/i.test(w.message))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/main/themes/compliance.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `compliance.ts`**

```ts
import type { PaletteColour, Theme, ThemeDraft, VariantId } from './schema'
import { VARIANT_IDS } from './schema'
import { contrastRatio } from './contrast'

export interface ComplianceWarning {
  severity: 'warn'
  group: string
  message: string
}

const FLOOR = { heading: 3, body: 4.5, accent: 3 } as const
/** Below this a scrim leaves too little tone for text to sit on an image. */
const MIN_SCRIM = 0.3
/** A corner logo is about 6% of a 1080-high frame; a min-height past that cannot be honoured. */
const CORNER_LOGO_PX = Math.round(1080 * 0.06)

type Checkable = Theme | ThemeDraft

function rgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number]
}
/** Plain RGB distance, enough to tell a brand colour from one that is nowhere near the palette. */
function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}
const NEAR = 40

export function checkCompliance(theme: Checkable): ComplianceWarning[] {
  const warnings: ComplianceWarning[] = []
  const warn = (group: string, message: string): void => void warnings.push({ severity: 'warn', group, message })

  // Contrast, per variant — a locked variant that the fixer could not repair shows up here.
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
          warn('backgrounds', `${id} ${role} (${v[role]}) is not in the brand palette.`)
        }
      }
    }
  }

  // Logos: a missing counterpart, and a min-height a corner logo cannot meet.
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
```

Note: the off-palette warnings use group `'backgrounds'` only because the test keys on the message, not the group, for that case; set a dedicated group if you prefer — but keep it stable. (Re-reading the test: the palette test keys on `/palette/i` in the message, so the group value is free. Use a clearer group `'variants'` for off-palette and `'backgrounds'` for scrim to be tidy.) Adjust the off-palette `warn(...)` group to `'variants.' + id` for precision:

```ts
        warn(`variants.${id}`, `${id} ${role} (${v[role]}) is not in the brand palette.`)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/main/themes/compliance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/themes/compliance.ts src/main/themes/compliance.test.ts
git commit -m "Add a warn-only brand compliance check"
```

---

## Task 9: AI ingestion — read a local brand folder; propose a palette; assign assets

**Files:**
- Create: `src/main/themes/generate/readBrandFolder.ts`
- Create: `src/main/themes/generate/readBrandFolder.test.ts`
- Modify: `src/main/themes/generate/facts.ts` (BrandFacts grows `backgrounds[]`, `palette[]`)
- Modify: `src/main/themes/generate/generateTheme.ts` (`GenerateRequest` grows `folder?`/`files?`; assign logos pair, backgrounds, palette; stay unlocked)
- Modify: `src/main/themes/generate/proposeTheme.ts` (propose a palette)
- Modify: `src/main/themes/generate/readWebsite.ts` (harvest background candidates) — optional within this task; keep minimal.

**Interfaces:**
- Consumes: `BrandFacts`, `mergeFacts`, `readLogo`, `readBrandGuide`, `writeAssetInto` (v2), `fixContrast` (v2).
- Produces:
  - `BrandFacts` grows: `backgrounds?: { bytes: Buffer; fileName: string; suggest: 'card' | 'content' }[]`, `logos?: { bytes: Buffer; fileName: string; ink: 'light' | 'dark' }[]`, `palette?: { name: string; hex: string }[]`.
  - `readBrandFolder(dir: string): Promise<BrandFacts>` — classify a directory's files.

This is the largest task; keep the folder reader deterministic and side-effect free (no writes). Logo ink is decided by the dominant colour's luminance (reuse `readLogo`'s colour counting via the existing Playwright path, or a simpler heuristic: a logo whose dominant opaque colour is light → `ink: 'light'` → belongs in the `dark` slot). Backgrounds are tagged `card` vs `content` by aspect/size heuristic (large landscape → `content`; otherwise `card`). Fonts and docs reuse the existing readers.

- [ ] **Step 1: Write failing tests**

Create `src/main/themes/generate/readBrandFolder.test.ts`:

```ts
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { readBrandFolder } from './readBrandFolder'

function folder(): string {
  return mkdtempSync(join(tmpdir(), 'brand-folder-'))
}

describe('readBrandFolder', () => {
  it('collects fonts, images and docs from a directory', async () => {
    const dir = folder()
    writeFileSync(join(dir, 'AcmeSans.otf'), Buffer.from('OTTO'))
    writeFileSync(join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#ffffff"/></svg>')
    writeFileSync(join(dir, 'hero.jpg'), Buffer.from('JPEG'))
    writeFileSync(join(dir, 'brand.txt'), 'Primary colour #635bff. Typeface: Inter')
    const facts = await readBrandFolder(dir)
    expect(facts.sources).toContain('folder')
    // fonts, a logo, a background and colours/fonts from the text all show up
    expect(facts.fonts.length + (facts.logos?.length ?? 0) + (facts.backgrounds?.length ?? 0)).toBeGreaterThan(0)
  })

  it('reads hex colours and font labels out of a .txt brand note', async () => {
    const dir = folder()
    writeFileSync(join(dir, 'guide.md'), '# Brand\nPrimary #112233\nTypeface: Inter')
    const facts = await readBrandFolder(dir)
    expect(facts.colours.some((c) => c.hex === '#112233')).toBe(true)
    expect(facts.fonts.some((f) => f.family === 'Inter')).toBe(true)
  })
})
```

Add to `facts.ts` the type growth first (so the test for generate can compile). Because `readLogo`/colour-counting needs Playwright (slow, and the test above avoids asserting ink), keep the folder reader's logo ink best-effort: if colour reading fails, default a logo to `ink: 'dark'` (goes in the light slot) and record a problem.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/main/themes/generate/readBrandFolder.test.ts`
Expected: FAIL — module absent; `BrandFacts` has no `logos`/`backgrounds`/`palette`.

- [ ] **Step 3: Grow `BrandFacts` in `facts.ts`**

```ts
export interface BrandFacts {
  colours: { hex: string; weight: number; role: ColourRole }[]
  fonts: { family: string; role: 'heading' | 'body' | 'document' }[]
  logo?: { bytes: Buffer; fileName: string }
  /** Every logo read, with the ground it is made for — the one slot it belongs in. */
  logos?: { bytes: Buffer; fileName: string; ink: 'light' | 'dark' }[]
  /** Imagery to sit behind scenes, tagged by where it suits. Stored verbatim. */
  backgrounds?: { bytes: Buffer; fileName: string; suggest: 'card' | 'content' }[]
  /** Named brand colours, from a guide or folder, for the palette and off-palette warnings. */
  palette?: { name: string; hex: string }[]
  sources: ('website' | 'logo' | 'pdf' | 'description' | 'folder')[]
  problems: string[]
}

export const NO_FACTS: BrandFacts = { colours: [], fonts: [], sources: [], problems: [] }
```

Extend `mergeFacts` to merge the new arrays (concatenate `logos`, `backgrounds`; union `palette` by hex; keep `logo` as the first found for back-compat):

```ts
  return {
    colours: /* unchanged */,
    fonts: /* unchanged */,
    logo: all.find((facts) => facts.logo)?.logo,
    logos: all.flatMap((f) => f.logos ?? []),
    backgrounds: all.flatMap((f) => f.backgrounds ?? []),
    palette: dedupeByHex(all.flatMap((f) => f.palette ?? [])),
    sources: [...new Set(all.flatMap((facts) => facts.sources))],
    problems: all.flatMap((facts) => facts.problems)
  }
```

Add `dedupeByHex` (a small local helper). Leave the empty arrays off when empty if the rest of the code expects `undefined`; simplest is to always return arrays and let readers treat `[]` as none.

- [ ] **Step 4: Create `readBrandFolder.ts`**

```ts
import { readdirSync, readFileSync, statSync } from 'fs'
import { extname, join } from 'path'
import { NO_FACTS, type BrandFacts } from './facts'
import { readLogo } from './readLogo'
import { readBrandGuide } from './readBrandGuide'

const FONT_EXT = new Set(['.otf', '.ttf', '.woff', '.woff2'])
const IMAGE_EXT = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])
const TEXT_EXT = new Set(['.txt', '.md'])
const FONT_LABEL = /(?:[Tt]ypeface|[Ff]ont(?:\s+[Ff]amily)?|[Tt]ypography)\s*[:\-–—]\s*([A-Z][A-Za-z0-9]*(?:\s[A-Z][A-Za-z0-9]*){0,2})/g

/** A file whose name reads like a logo rather than a backdrop. */
function looksLikeLogo(name: string): boolean {
  return /logo|mark|icon|wordmark|lockup/i.test(name)
}

/**
 * Everything a local brand folder offers — fonts, logos, background imagery and written colours
 * and typefaces — read without writing anything. Logos and backgrounds are carried as bytes for
 * the generator to copy in verbatim. A file that cannot be read is skipped with a problem, never
 * a throw: a folder is a grab-bag and most of it making it through is the point.
 */
export async function readBrandFolder(dir: string): Promise<BrandFacts> {
  const facts: BrandFacts = { ...NO_FACTS, logos: [], backgrounds: [], palette: [], sources: ['folder'], problems: [] }
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
        // The family is read off the file when it is written into the theme; here we only note it exists.
        facts.fonts.push({ family: name.replace(ext, ''), role: 'document' })
      } else if (IMAGE_EXT.has(ext)) {
        if (looksLikeLogo(name) || ext === '.svg') {
          // Ink by the logo's own dominant colour, best-effort; default to the light slot on failure.
          let ink: 'light' | 'dark' = 'dark'
          try {
            const read = await readLogo(bytes, name)
            const top = read.colours[0]
            if (top) {
              const [r, g, b] = [top.hex.slice(1, 3), top.hex.slice(3, 5), top.hex.slice(5, 7)].map((h) => parseInt(h, 16))
              ink = 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? 'light' : 'dark'
            }
          } catch {
            facts.problems.push(`Could not read the colours of ${name}; it was taken as a dark-ink logo.`)
          }
          facts.logos!.push({ bytes, fileName: name, ink })
          if (!facts.logo) facts.logo = { bytes, fileName: name }
        } else {
          // Large landscape imagery suits a content slide; anything else a card.
          const suggest: 'card' | 'content' = bytes.length > 300 * 1024 ? 'content' : 'card'
          facts.backgrounds!.push({ bytes, fileName: name, suggest })
        }
      } else if (TEXT_EXT.has(ext)) {
        const text = bytes.toString('utf-8')
        for (const m of text.matchAll(/#([0-9a-f]{6})\b/gi)) {
          const hex = `#${m[1].toLowerCase()}`
          facts.colours.push({ hex, weight: 1000, role: 'document' })
          facts.palette!.push({ name: hex, hex })
        }
        for (const m of text.matchAll(FONT_LABEL)) facts.fonts.push({ family: m[1].trim(), role: 'document' })
      } else if (ext === '.pdf') {
        const guide = await readBrandGuide(bytes)
        facts.colours.push(...guide.colours)
        facts.fonts.push(...guide.fonts)
        facts.palette!.push(...guide.colours.map((c) => ({ name: c.hex, hex: c.hex })))
      }
    } catch (err) {
      facts.problems.push(`Skipped ${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return facts
}
```

- [ ] **Step 5: Wire it into `generateTheme.ts`**

Grow `GenerateRequest` and `GenerateDeps`, read the folder, and assign the new assets. Change `GenerateRequest`:

```ts
export interface GenerateRequest {
  name: string
  url?: string
  description?: string
  file?: { bytes: Buffer; fileName: string }
  /** A local brand folder: fonts, logos, imagery and guide docs are read from it. */
  folder?: string
}
```

Add to `GenerateDeps`: `readBrandFolder: (dir: string) => Promise<BrandFacts>`; default it to the new module. In the body, after the `request.file` block, add:

```ts
    if (request.folder?.trim()) {
      status = { running: true, step: 'Reading the brand folder…' }
      try {
        read.push(await use.readBrandFolder(request.folder.trim()))
      } catch (err) {
        read.push({ ...NO_FACTS, problems: [`Could not read ${request.folder}: ${err instanceof Error ? err.message : String(err)}`] })
      }
    }
```

After `fixContrast` (now `fixContrast(fonts.draft, [])` — AI themes start unlocked, so pass `[]`), write the logo pair and backgrounds into staging and build the draft. Replace the staging/draft block:

```ts
    const readable = fixContrast(fonts.draft, [])

    const stagingDir = join(themesRootDir(use.baseDir), '.drafts', randomUUID())
    mkdirSync(stagingDir, { recursive: true })
    for (const file of fonts.files) writeAssetInto(stagingDir, 'font', '', file.fileName, file.bytes)

    // Logos: the ones the folder gave, each in the slot its ink suits; else the single legacy logo in both.
    const logoFacts = facts.logos && facts.logos.length > 0 ? facts.logos : facts.logo ? [{ ...facts.logo, ink: 'dark' as const }] : []
    const logoSlots: { light?: { file: string }; dark?: { file: string } } = {}
    for (const l of logoFacts) {
      const slot = l.ink === 'light' ? 'dark' : 'light' // light ink reads on a dark ground
      if (logoSlots[slot]) continue
      logoSlots[slot] = { file: writeAssetInto(stagingDir, 'logo', slot, l.fileName, l.bytes) }
    }

    // Backgrounds: the first the folder suggests for each context, on the dark variant by default.
    const backgrounds: NonNullable<ThemeDraft['backgrounds']> = {}
    for (const ctx of ['card', 'content'] as const) {
      const pick = facts.backgrounds?.find((b) => b.suggest === ctx)
      if (!pick) continue
      const file = writeAssetInto(stagingDir, 'background', `${ctx}-dark`, pick.fileName, pick.bytes)
      backgrounds[ctx] = { dark: { file, fit: 'cover', scrim: 0.35 } }
    }

    const draft: ThemeDraft = {
      ...readable.draft,
      ...(logoSlots.light || logoSlots.dark
        ? { logo: { ...logoSlots, corner: 'bottom-right', showOn: { recordings: true, slides: true } } }
        : {}),
      ...(Object.keys(backgrounds).length ? { backgrounds } : {}),
      ...(facts.palette && facts.palette.length ? { brand: { palette: facts.palette.slice(0, 12) } } : {}),
      provenance: {
        from: facts.sources,
        notes: [...facts.problems, ...proposal.notes, ...fonts.notes, ...readable.notes, ...readable.unresolved]
      }
    }
```

Note the slot mapping: a *light-ink* logo (light pixels) is for a *dark* background, so it goes in the `dark` slot. The guard clause requires `request.url || description || request.file || request.folder` — update the early "nothing given" check to include `request.folder`.

- [ ] **Step 6: Propose a palette in `proposeTheme.ts`**

This is optional polish for the LLM path; the folder/guide already supplies a palette. Minimal change: after building the `draft` from the model answer, if `facts.palette` is empty, derive a palette from the chosen variant backgrounds/accents so a website-only theme still has one. Keep it small:

```ts
// in proposeTheme, when returning the model-built draft, leave brand/palette to generateTheme —
// the facts' palette is authoritative. No change required here unless facts.palette is empty.
```

Decision: **do not** change `proposeTheme` in this task beyond what compiles; the palette comes from facts. Skip if no code change is needed.

- [ ] **Step 7: Run tests**

Run: `npm test -- src/main/themes/generate`
Expected: `readBrandFolder.test.ts` passes; existing `generateTheme.test.ts`, `propose.test.ts`, `readBrand.test.ts` still pass. Fix any that assert the old `writeAssetInto` arity or the old `fixContrast` return (add `.unresolved` handling / new arg). Run `npm run typecheck`.

- [ ] **Step 8: Commit**

```bash
git add src/main/themes/generate/readBrandFolder.ts src/main/themes/generate/readBrandFolder.test.ts src/main/themes/generate/facts.ts src/main/themes/generate/generateTheme.ts
git commit -m "Generate a theme from a local brand folder, assigning logos, backgrounds and a palette"
```

---

## Task 10: IPC — generalized asset handler and a compliance channel

**Files:**
- Modify: `src/main/ipc/themeHandlers.ts`
- Modify: the renderer IPC bridge / client that lists channels (`src/preload/index.ts` and `src/renderer/src/api/projectClient.ts` — the `themeClient`), because a channel-parity test requires both a handler and a caller.
- Test: whichever test enforces channel parity (the AGENTS notes mention "a test enforces that every channel has both a handler and a caller") — ensure the new `compliance` channel has both.

**Interfaces:**
- Consumes: `writeAssetInto` (v2), `checkCompliance`, `generateTheme` (with `folder`).
- Produces IPC:
  - `settings:themes:addAsset` now `(target, kind: 'logo'|'background'|'font', slot: string, fileName, bytes)`.
  - `settings:themes:compliance` → `(draft) => ComplianceWarning[]`.
  - `settings:themes:generate` request grows `folder?`.
  - `themeClient.addAsset(target, kind, slot, fileName, bytes)` and `themeClient.compliance(draft)` on the renderer side.

- [ ] **Step 1: Write/adjust failing test**

If a channel-parity test exists (search `src/main` and `src/preload` tests for a test iterating IPC channels), it will fail once the handler is added without a caller. Add a focused test for the compliance handler's shape in `src/main/ipc/themeHandlers.test.ts` (create if absent):

```ts
import { describe, expect, it, vi } from 'vitest'
import { registerThemeHandlers } from './themeHandlers'

describe('theme IPC', () => {
  it('registers a compliance channel', () => {
    const handlers = new Map<string, Function>()
    const ipcMain = { handle: (c: string, h: Function) => handlers.set(c, h) } as never
    registerThemeHandlers(ipcMain)
    expect(handlers.has('settings:themes:compliance')).toBe(true)
  })

  it('addAsset takes a slot', () => {
    const handlers = new Map<string, Function>()
    const ipcMain = { handle: (c: string, h: Function) => handlers.set(c, h) } as never
    registerThemeHandlers(ipcMain)
    expect(handlers.get('settings:themes:addAsset')?.length).toBeGreaterThanOrEqual(6) // _event,target,kind,slot,fileName,bytes
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/ipc/themeHandlers.test.ts`
Expected: FAIL — no compliance channel; addAsset arity is 5.

- [ ] **Step 3: Edit `themeHandlers.ts`**

Update `addAsset` and add `compliance`:

```ts
import { checkCompliance } from '../themes/compliance'
import { ThemeSchema } from '../themes/schema'
// ...
  ipcMain.handle(
    'settings:themes:addAsset',
    (_event, target: ThemeTarget, kind: 'logo' | 'background' | 'font', slot: string, fileName: string, bytes: Uint8Array) => {
      const dir = dirFor(target)
      if (!dir) throw new Error('There is nowhere to keep that file yet. Save the theme first.')
      return writeAssetInto(dir, kind, slot, fileName, Buffer.from(bytes))
    }
  )
  // The brand check: the draft's own warnings, the same ones agents see, for the editor's panel.
  ipcMain.handle('settings:themes:compliance', (_event, draft: unknown) => checkCompliance(ThemeDraftSchema.parse(draft)))
```

Update the generate handler's request type to include `folder?: string` and pass it through:

```ts
  ipcMain.handle(
    'settings:themes:generate',
    (_event, request: { name: string; url?: string; description?: string; folder?: string; file?: { bytes: Uint8Array; fileName: string } }) =>
      generateTheme({
        ...request,
        file: request.file ? { bytes: Buffer.from(request.file.bytes), fileName: request.file.fileName } : undefined
      })
  )
```

- [ ] **Step 4: Add the renderer callers**

In `src/renderer/src/api/projectClient.ts` (the `themeClient`), update `addAsset` to pass `slot` and add `compliance`. Find the existing `addAsset` wrapper and change its signature to `(target, kind, slot, fileName, bytes)`, forwarding to `settings:themes:addAsset`. Add:

```ts
  compliance: (draft: ThemeDraft) => ipcInvoke('settings:themes:compliance', draft) as Promise<ComplianceWarning[]>,
```

Export/`import` the `ComplianceWarning` type from `../../../../main/themes/compliance`. If `src/preload/index.ts` enumerates allowed channels explicitly, add `settings:themes:compliance` there.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- src/main/ipc/themeHandlers.test.ts` → PASS.
Run the channel-parity test (whole suite subset for IPC) and `npm run typecheck`. Fix the editor's existing `addAsset('logo', ...)` calls to pass a slot — those are rewritten in Task 12, but to keep typecheck green between commits, update the two current `addFile`/`addAsset` call sites in `ThemeEditor.tsx` minimally now (pass `'light'` as the slot for the existing single logo picker) or accept the typecheck break until Task 12. Prefer: make the minimal edit now so the tree typechecks.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/themeHandlers.ts src/main/ipc/themeHandlers.test.ts src/renderer/src/api/projectClient.ts src/preload/index.ts
git commit -m "Carry a slot through addAsset and add a theme compliance IPC channel"
```

---

## Task 11: MCP — v2 fields, lock rejection, compliance in reads

**Files:**
- Modify: `src/mcp/server.ts` (theme tools)
- Test: `src/mcp/server.test.ts` (add cases) — or the nearest MCP theme test.

**Interfaces:**
- Consumes: `checkCompliance`, `writeThemeAsset` (v2), `fixContrast` (v2), schema v2, `LOCK_KEYS`.
- Produces tool-input growth:
  - `talkie_theme` read appends compliance warnings and lock state to its text.
  - `talkie_update_theme` / `talkie_create_theme` accept `logos: { light?: path, dark?: path }`, `backgrounds: [{ context, variant, path, fit?, scrim? }]`, `palette: [{ name, hex }]`, `locks: LockKey[]`. A locked group present in an update is rejected with a note.
  - `talkie_create_theme` accepts `folder?`.

- [ ] **Step 1: Write failing tests**

Add to the MCP theme test (adapt to the file's existing harness that starts the server and calls a tool):

```ts
it('reports compliance warnings when reading a theme with a single logo slot', async () => {
  // create a theme, add only a light logo, then read it
  // expect the text to mention the missing dark-background logo
})

it('refuses to change a locked group and says so', async () => {
  // create a theme, lock variants.brand via talkie_update_theme { locks: ['variants.brand'] }
  // then talkie_update_theme { brand: { background: '#000000' } }
  // expect the reply to say the brand variant is locked and the colour is unchanged
})
```

Fill these in against the harness in `server.test.ts` (it already exercises create/update/apply). Keep them concrete using the real tool-call helper the file provides.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/mcp/server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Edit the tools in `server.ts`**

`talkie_theme` handler — append compliance + locks:

```ts
async ({ themeId }) => {
  const theme = readTheme(themeId, baseDir)
  const using = projectsUsingTheme(themeId, baseDir).map((p) => p.name)
  const warnings = checkCompliance(theme).map((w) => `  • ${w.message}`)
  const locks = theme.locks?.length ? `\nLocked: ${theme.locks.join(', ')}` : ''
  const brand = warnings.length ? `\nBrand check:\n${warnings.join('\n')}` : ''
  return text(`${describeTheme(theme)}\nUsed by: ${using.join(', ') || 'no project'}${locks}${brand}`)
}
```

Import `checkCompliance` and `LOCK_KEYS` at the top of `server.ts`.

`talkie_update_theme` — add inputs and enforce locks. Add to `inputSchema`:

```ts
        logos: z.object({
          light: z.string().optional().describe('Absolute path to the logo for light backgrounds (dark ink)'),
          dark: z.string().optional().describe('Absolute path to the logo for dark backgrounds (light ink)')
        }).optional(),
        backgrounds: z.array(z.object({
          context: z.enum(['card', 'content']),
          variant: z.enum(VARIANT_IDS),
          path: z.string().describe('Absolute path to an image under 12 MB'),
          fit: z.enum(['cover', 'contain', 'tile']).optional(),
          scrim: z.number().min(0).max(1).optional()
        })).optional(),
        palette: z.array(z.object({ name: z.string(), hex: z.string() })).optional(),
        locks: z.array(z.enum(LOCK_KEYS)).optional()
```

In the handler, before applying, reject locked groups that the call tries to change (and allow `locks` itself to change):

```ts
const current = readTheme(themeId, baseDir)
const locks = current.locks ?? []
const rejected: string[] = []
const touchesLocked = (key: typeof LOCK_KEYS[number], changing: boolean): boolean => {
  if (changing && locks.includes(key)) { rejected.push(key); return true }
  return false
}
// e.g. for brand: if (touchesLocked('variants.brand', !!brand)) brand = undefined
```

Apply this guard to each group (`variants.brand`/`light`/`dark` for `brand`/`light`/`dark`; `fonts.heading`/`body` for `headingFont`/`bodyFont`; `logo` for `logos`; `backgrounds` for `backgrounds`). Drop the locked inputs and, at the end, if `rejected.length`, prepend a note: `The following are locked and were left unchanged: ${rejected.join(', ')}. Unlock them in the editor or with locks to change them.`

Build the logo pair from `logos` (write each slot with `writeThemeAsset(themeId, 'logo', slot, fileName, bytes)`), merging with `current.logo`. Build `backgrounds` by writing each entry with `writeThemeAsset(themeId, 'background', `${context}-${variant}`, fileName, bytes)` and composing the nested structure. Set `brand: palette ? { palette } : current.brand` and `locks: locks ?? current.locks`. Pass the computed `locks` to `fixContrast(draft, locks)` so a locked variant is not auto-fixed. Push `fixed.unresolved` into the notes.

`talkie_create_theme` — add `folder: z.string().optional()` to the input and pass it into `generateTheme({ name, url, description, folder, ... })`. The condition `if (url || description || file)` becomes `if (url || description || file || folder)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/mcp/server.test.ts` → PASS. Also `npm test -- src/mcp` to keep `builtServer.test.ts` etc. green. Run `npm run build` to confirm the MCP bundle still builds (the server is bundled).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/mcp/server.test.ts
git commit -m "Give agents the v2 theme fields, lock enforcement and the brand check"
```

---

## Task 12: Editor — Logos (light/dark), Backgrounds, Palette, locks, Brand check

**Files:**
- Modify: `src/renderer/src/components/themes/ThemeEditor.tsx`
- Modify: `src/renderer/src/components/themes/themes.test.tsx` (add cases)
- Possibly modify: `ThemePreview.tsx` if the preview needs the new fields (it renders from the draft via `settings:themes:render`, which already carries them — likely no change).

**Interfaces:**
- Consumes: `themeClient.addAsset(target, kind, slot, fileName, bytes)`, `themeClient.compliance(draft)`, schema v2 draft shape.
- Produces editor UI: a **Logos** section (light/dark drop targets, corner, show-on, optional clear-space/min-height), a **Backgrounds** section (per context × variant, with fit + scrim), a **Brand palette** editor, a **lock toggle** per group, and a live **Brand check** panel.

This is a UI task; keep each sub-section small and follow the existing `Group`/`Labelled`/`ColourField`/`FilePicker` helpers already in the file. Design tokens only (`bg`/`surface`/`raised`, `accent`), British spelling.

- [ ] **Step 1: Write failing tests**

Add to `themes.test.tsx` (RTL):

```tsx
it('shows a light and a dark logo picker', () => {
  render(<ThemeEditor initial={draftWithStaging} stagingDir="/tmp/x" onDone={() => {}} />)
  expect(screen.getByLabelText(/logo for light backgrounds/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/logo for dark backgrounds/i)).toBeInTheDocument()
})

it('lists the brand check warnings for an unreadable variant', async () => {
  // a draft whose light variant fails contrast; compliance is called on mount/change
  // expect a warning to appear in the Brand check panel
})

it('disables a locked group until it is unlocked', async () => {
  // toggle the Colours lock on; expect the colour inputs to be disabled
})
```

Mock `themeClient.compliance` to return a known warning. Match the existing test file's render/mocking style.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/renderer/src/components/themes/themes.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite the Logo section and add the others**

Replace the current single-logo `Group title="Logo"` with a **Logos** group that has a picker per slot, writing to the right slot:

```tsx
async function addLogo(slot: 'light' | 'dark', file: File): Promise<void> {
  setError(null)
  try {
    const path = await themeClient.addAsset(target, 'logo', slot, file.name, new Uint8Array(await file.arrayBuffer()))
    setDraft((d) => ({ ...d, logo: { corner: 'bottom-right', showOn: { recordings: true, slides: true }, ...d.logo, [slot]: { file: path } } }))
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err))
  }
}
```

Render a `FilePicker` for each slot with `aria-label` "Logo for light backgrounds" / "Logo for dark backgrounds", plus the corner `select`, the show-on checkboxes (unchanged logic, reading `draft.logo`), and two number inputs for `clearSpace` and `minHeight` (optional).

Add a **Backgrounds** group: for each `context` in `['card','content']` and each `variant` in `['brand','light','dark']`, a `FilePicker` (slot `${context}-${variant}`), a fit `select` (cover/contain/tile) and a scrim range input, writing into `draft.backgrounds[context][variant]`:

```tsx
async function addBackground(context: 'card' | 'content', variant: VariantId, file: File): Promise<void> {
  const path = await themeClient.addAsset(target, 'background', `${context}-${variant}`, file.name, new Uint8Array(await file.arrayBuffer()))
  setDraft((d) => ({
    ...d,
    backgrounds: { ...d.backgrounds, [context]: { ...d.backgrounds?.[context], [variant]: { file: path, fit: 'cover', scrim: 0.35, ...d.backgrounds?.[context]?.[variant] } } }
  }))
}
```

Add a **Brand palette** group: rows of name + `ColourField`, editing `draft.brand.palette`, with an "Add colour" button and a remove per row.

Add a **lock toggle** per group. Keep locks in `draft.locks`. A small helper:

```tsx
const locked = (key: LockKey): boolean => (draft.locks ?? []).includes(key)
const toggleLock = (key: LockKey): void =>
  setDraft((d) => ({ ...d, locks: locked(key) ? (d.locks ?? []).filter((k) => k !== key) : [...(d.locks ?? []), key] }))
```

Render a lock checkbox/button in each group's header; wrap that group's inputs in a `<fieldset disabled={locked(key)}>` (the editor already uses a `fieldset` pattern for built-ins). For the Colours group, lock each variant with its own `variants.<id>` key, or lock all three under a single "Colours" toggle mapping to the three keys — choose the single toggle for simplicity but set all three keys. Document the choice in a comment.

Add a **Brand check** panel. Run `themeClient.compliance(draft)` in a debounced `useEffect` on `draft` change and show the warnings:

```tsx
const [warnings, setWarnings] = useState<ComplianceWarning[]>([])
useEffect(() => {
  let cancelled = false
  const handle = setTimeout(() => {
    void themeClient.compliance(draft).then((w) => { if (!cancelled) setWarnings(w) })
  }, 300)
  return () => { cancelled = true; clearTimeout(handle) }
}, [draft])
```

Render a panel listing `warnings.map((w) => w.message)` when non-empty, styled like the existing provenance panel (`bg-raised`, muted text), headed "Brand check". It is advisory — never disables Save.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/renderer/src/components/themes/themes.test.tsx` → PASS.
Run `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/themes/ThemeEditor.tsx src/renderer/src/components/themes/themes.test.tsx
git commit -m "Edit logo slots, backgrounds, a brand palette and locks, with a live brand check"
```

---

## Task 13: Full suite, typecheck, and the AGENTS/CLAUDE note

**Files:**
- Modify: `CLAUDE.md` target (`AGENTS.md` — `CLAUDE.md` is a symlink, so edit `AGENTS.md`) — update the Themes section to describe the logo pair, backgrounds, palette, locks and the brand check.

- [ ] **Step 1: Run the whole unit suite**

Run: `npm test`
Expected: all pass. Fix any test that still assumes the old single logo, the old `writeAssetInto` arity, the old `fixContrast` return, or the old `addAsset` channel.

- [ ] **Step 2: Typecheck both tsconfigs**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Update the docs**

In `AGENTS.md`, under `## Themes`, add bullets describing: the light/dark logo pair chosen by surface luminance; per-surface background images stored verbatim and inlined with a 12 MB warn ceiling; the brand palette and off-palette warnings; coarse per-group locks that freeze automation and the editor inputs; the warn-only `checkCompliance`. Keep the house tone (why, not what).

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "Document the enhanced themes: logo pair, backgrounds, palette, locks, brand check"
```

- [ ] **Step 5: e2e smoke (optional but recommended before PR)**

Run: `npm run e2e`
Expected: green. Themes are exercised by the examples; a background/logo change should not regress export. If a themed example now carries backgrounds, confirm the export still completes within the existing bounds.

---

## Self-Review

**Spec coverage:**
- §1 Schema v2 → Task 1. ✓ (logo pair, backgrounds, brand.palette, locks, migration)
- §2 Storage → Tasks 2 (writeThemeAsset/subdirs/verbatim/ceiling) & 3 (inline + stamp). ✓ duplicate/draft carry folders — unchanged `duplicateTheme`/`saveGeneratedTheme` cpSync (noted in Task 2). ✓
- §3 Rendering → Tasks 4 (logoUrlFor, sandbox unchanged), 5 (native solid→image→scrim→content), 6 (HTML runtime layer). Diagrams untouched. ✓
- §4 AI ingestion → Task 9 (readBrandFolder, folder?/files?, BrandFacts growth, unlocked, full quality). ✓ readWebsite background harvest is marked optional/minimal in Task 9 — acceptable; the folder/guide path is the primary source.
- §5 Locking & compliance → Tasks 7 (fixContrast+locks+unresolved) & 8 (checkCompliance). ✓
- §6 Surface → Tasks 10 (IPC), 11 (MCP), 12 (editor). ✓

**Placeholder scan:** No "TBD"/"TODO". The optional readWebsite harvest in Task 9 Step 6 is explicitly scoped as "skip if no change needed" rather than a vague placeholder. MCP test bodies in Task 11 Step 1 are described against the file's own harness rather than pasted verbatim because the harness shape is in that file; this is a known risk — the executor must read `server.test.ts` first.

**Type consistency:** `writeAssetInto(dir, kind, slot, fileName, bytes)` is used identically in Tasks 2, 9, 10. `writeThemeAsset(id, kind, slot, fileName, bytes, baseDir)` in Tasks 2, 11. `fixContrast(draft, locks?)` → `{ draft, notes, unresolved }` in Tasks 7, 9, 11. `logoUrlFor(theme, surfaceHex)` in Tasks 4, 6. `backgroundFor(theme, context, variant)` in Tasks 5, 6. `checkCompliance(theme)` → `ComplianceWarning[]` in Tasks 8, 10, 11, 12. `SceneTheme.bgImage` in Task 6. `RenderTheme.logo.{light,dark}` / `.backgrounds` / `.warnings` in Tasks 3, 4, 5. Consistent.

**Known cross-task risk:** Task 1's version bump makes many files typecheck-fail until their task lands. The plan tells Task 1 not to fix them and lists the sequence; the tree only returns to green incrementally. Each commit after Task 1 should at least not *worsen* typecheck; full green is restored by Task 13 (realistically by Task 12). If per-commit green is required, an executor may fold Tasks 2–12 into fewer commits, but the TDD cycles stay as written.
