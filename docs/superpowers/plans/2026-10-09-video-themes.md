# Video Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A theme library in `~/Talkie/Themes` — made by hand or by AI from a website, description, logo or brand guide — that every slide, diagram, caption, logo overlay, opening/closing card and new recording in a project follows.

**Architecture:** Themes are JSON plus asset files, managed by `src/main/themes/themeApi.ts`. A project stores `themeId`. `toRenderTheme` turns a theme into a self-contained `RenderTheme` (colours, fonts and logo as data URLs) that the composition receives beside the timeline, for both preview and export. AI generation is a main-process pipeline: extract facts (Playwright / pdfjs), let the configured narration provider propose, fall back to rules, fetch open fonts, fix contrast.

**Tech Stack:** TypeScript, zod, React, Playwright (headless Chromium), pdfjs-dist, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-09-video-themes-design.md`

## Global Constraints

- Branch `feature/themes`, stacked on `feature/voice-quality` (PR #18).
- Main and preload stay CommonJS `.cjs`; the renderer reaches main only through `window.api`.
- IPC channels are `project:*`, `settings:*` or `menu:*`, each with a handler and a caller (`channelCoverage.test.ts`).
- Every theme operation exists as create, read, modify, delete and apply (AGENTS.md "five verbs").
- A project with no `themeId` renders exactly as before this work.
- Theme assets reach the composition as data URLs: logo ≤ 2 MB, fonts ≤ 3 MB total.
- Logos are rendered with `<Img>`, never inline SVG.
- Website reading: headless, read-only (no click, type, navigation), 30 s cap, http(s) only in production.
- Fonts downloaded only from Google Fonts families under `ofl/` or `apache/` in `google/fonts`.
- Contrast: body text ≥ 4.5:1, headings ≥ 3:1, accent mark ≥ 3:1 against its background.
- British spelling in names and UI text (colour, licence). Comments say why, not what. Tests are named as sentences about behaviour.
- Browser-driving tests get ≥ 60 s timeouts.
- `npm test` and `npm run typecheck` pass before each commit.

---

## File map

| File | Responsibility |
|---|---|
| `src/main/themes/schema.ts` | `ThemeSchema`, `ThemeDraftSchema`, `VariantSchema`, `FontChoiceSchema`; defaults |
| `src/main/themes/contrast.ts` | colour maths (hex ↔ OKLCH), `contrastRatio`, `fixContrast` |
| `src/main/themes/themeApi.ts` | library storage: list/read/create/update/delete, assets, projects using a theme |
| `src/composition/renderTheme.ts` | `RenderTheme` type, `ThemeContext`, `themeStamp` (pure; used by main and composition) |
| `src/main/themes/toRenderTheme.ts` | theme on disk → `RenderTheme` with data URLs |
| `src/composition/sceneTheme.ts` | `resolveSceneTheme(style, theme?)` — variants with fallback to today's palettes |
| `src/composition/ThemeFonts.tsx`, `LogoOverlay.tsx` | font loading with a hold; logo corner overlay |
| `src/main/slides/mermaidTheme.ts` | `mermaidConfigFor(theme?)` replacing the fixed config |
| `src/main/themes/applyTheme.ts` | `setProjectTheme` with first-time bookends |
| `src/main/themes/generate/*.ts` | `readWebsite`, `readLogo`, `readBrandGuide`, `proposeTheme`, `ruleBasedTheme`, `resolveFonts`, `generateTheme` |
| `src/renderer/src/components/themes/*.tsx` | `ThemesSection`, `ThemeEditor`, `CreateThemeDialog`, `ThemePicker` |
| `src/mcp/server.ts` | six theme tools |

---

### Task 1: Theme schema and contrast

**Files:**
- Create: `src/main/themes/schema.ts`, `src/main/themes/contrast.ts`
- Test: `src/main/themes/schema.test.ts`, `src/main/themes/contrast.test.ts`

**Interfaces — Produces:**
```ts
// schema.ts
export const VARIANT_IDS = ['brand', 'light', 'dark'] as const
export type VariantId = (typeof VARIANT_IDS)[number]
export const VariantSchema: z.ZodObject<{ background, heading, body, accent }>  // all hex '#rrggbb'
export const FontChoiceSchema: z.ZodObject<{ family: string; files: string[]; source: 'google'|'user'|'builtin' }>
export const ThemeSchema  // id, name, createdAt, schemaVersion, company, tagline, website, variants{brand,light,dark}, fonts{heading,body}, logo?, overlays{highlight, caption: VariantId}, provenance?{from: string[], notes: string[]}
export const ThemeDraftSchema = ThemeSchema.omit({ id, createdAt, schemaVersion })
export type Theme, ThemeDraft, Variant, FontChoice
export const BUILTIN_FONTS = { sans: 'Geist Variable', serif: 'Newsreader Variable' }
export function defaultThemeDraft(name: string): ThemeDraft   // today's palettes as variants
// contrast.ts
export function contrastRatio(a: string, b: string): number
export function fixContrast(draft: ThemeDraft): { draft: ThemeDraft; notes: string[] }
```

- [ ] **Step 1: Failing tests** — schema: a full theme parses; a non-hex colour is refused; `defaultThemeDraft` gives dark = graphite `#171b22`-ish background, light = paper, brand = brass; `caption` defaults to `dark`. Contrast: `contrastRatio('#000000','#ffffff')` ≈ 21; `#777777` on `#ffffff` fails 4.5 and `fixContrast` darkens body text until ≥ 4.5 and records a note naming the variant and both colours; a passing theme is returned unchanged with no notes.
- [ ] **Step 2:** `npx vitest run src/main/themes` — FAIL (modules missing).
- [ ] **Step 3: Implement.** Colour maths: sRGB → linear → OKLab → OKLCH and back (Björn Ottosson's matrices); relative luminance per WCAG 2.x; `fixContrast` steps OKLCH lightness by 0.02 towards black on light backgrounds and white on dark, at most 50 steps, per colour (heading 3:1, body 4.5:1, accent 3:1).
- [ ] **Step 4:** tests PASS. **Step 5:** commit `Add the theme schema and a contrast fixer`.

### Task 2: Theme library storage

**Files:** Create `src/main/themes/themeApi.ts`; Test `src/main/themes/themeApi.test.ts`

**Interfaces — Consumes:** Task 1. **Produces:**
```ts
export function themesRootDir(baseDir?: string): string                 // <base>/Talkie/Themes
export function listThemes(baseDir?): Theme[]                            // newest first; unreadable skipped
export function readTheme(id, baseDir?): Theme                           // throws "No theme found with id …"
export function findThemeDir(id, baseDir?): string | undefined
export function createTheme(draft: ThemeDraft, baseDir?): Theme
export function updateTheme(id, draft: ThemeDraft, baseDir?): Theme
export function deleteTheme(id, baseDir?): void
export function writeThemeAsset(id, kind: 'logo'|'font', fileName: string, bytes: Buffer, baseDir?): string // relative path
export function projectsUsingTheme(id, baseDir?): { id: string; name: string }[]
```
- [ ] Tests: create → folder `<id>-<slug>` with theme.json; list returns it; update keeps id/createdAt; delete removes folder; `writeThemeAsset('logo', 'acme.svg')` stores `logo.svg` and rejects other extensions (`.exe`), logo > 2 MB rejected; fonts only `.woff2 .woff .ttf .otf`; `projectsUsingTheme` lists projects whose project.json has the id (requires Task 4's `themeId` field — write the field directly in the fixture JSON).
- [ ] Implement with `writeJsonAtomic`, `slugify`, `randomUUID`; commit `Keep a library of themes in ~/Talkie/Themes`.

### Task 3: RenderTheme and scene variants

**Files:** Create `src/composition/renderTheme.ts`, `src/main/themes/toRenderTheme.ts`; Modify `src/composition/sceneTheme.ts`, `src/main/project/timeline/schema.ts`, `src/renderer/src/components/SceneEditor.tsx`; Tests `src/composition/sceneTheme.test.ts`, `src/main/themes/toRenderTheme.test.ts`, `src/main/project/timeline/sceneStyle.test.ts`

**Produces:**
```ts
// renderTheme.ts (no node imports)
export interface RenderTheme {
  stamp: string
  company: string; tagline: string; website: string
  variants: Record<VariantId, Variant>
  fonts: { heading: { family: string; urls: string[] }; body: { family: string; urls: string[] } }
  logo?: { url: string; corner: Corner; showOn: { recordings: boolean; slides: boolean } }
  caption: VariantId
}
export const ThemeContext: React.Context<RenderTheme | null>
export function useRenderTheme(): RenderTheme | null
export function themeStamp(theme: Pick<Theme,'variants'|'fonts'>): string  // short stable hash
// toRenderTheme.ts
export function toRenderTheme(themeId: string | undefined, baseDir?): RenderTheme | null
// sceneTheme.ts
export function resolveSceneTheme(style: SceneStyle | undefined, theme?: RenderTheme | null): ResolvedSceneTheme
```
`SceneStyleSchema.theme` → `z.preprocess(old → new, z.enum(VARIANT_IDS)).default('dark')`; mapping graphite/ink → dark, paper → light, brass → brand. `TextSceneDataSchema` gains `layout: z.enum(['standard','title','closing']).default('standard')`.

- [ ] Tests: old `graphite` parses as `dark`; without a theme `resolveSceneTheme({theme:'dark'})` equals today's graphite output, `light` equals paper, `brand` equals brass, and `font`/`accent` still apply; with a theme the variant's colours and the theme's font families are used and `accent` in style is ignored; `toRenderTheme` embeds logo and fonts as `data:` URLs, drops a missing file, returns null for unknown id, and refuses fonts over 3 MB total by dropping the extras with the built-in family kept.
- [ ] SceneEditor: `THEME_CHOICES` become Brand / Light / Dark, swatches from `resolveSceneTheme`.
- [ ] Commit `Let slides pick a variant of the project's theme`.

### Task 4: The composition follows the theme

**Files:** Modify `src/composition/DemoComposition.tsx`, `src/composition/index.tsx`, `src/composition/items/TextScene.tsx`, `src/composition/items/DiagramScene.tsx`, `src/composition/CaptionOverlay.tsx`; Create `src/composition/ThemeFonts.tsx`, `src/composition/LogoOverlay.tsx`; Tests `src/composition/themedComposition.test.tsx`

- `DemoComposition({ timeline, theme })` wraps everything in `ThemeContext.Provider` and `<ThemeFonts/>`; adds `<LogoOverlay kind={item.kind} layout={…}/>` per clip.
- `ThemeFonts`: `@font-face` for each url, a hold until `document.fonts.load('1em "<family>"')` for both, `continueRender` in `finally` (a failed font must not hang the render).
- `TextScene`: theme fonts/colours via `resolveSceneTheme(style, useRenderTheme())`; `layout: 'title'` → large logo, company, title; `'closing'` → logo, tagline, website.
- `CaptionOverlay`: background/text from `theme.variants[theme.caption]` and body font when a theme is present.
- `LogoOverlay`: corner placement 4% inset, height 6% of frame; shows on `video`/`image` when `showOn.recordings`, on `scene`/`diagram` (standard layout) when `showOn.slides`.
- [ ] Tests (render with Testing Library inside a renderer-free wrapper — mock the clock hooks as `DemoComposition.test.ts` does): no theme → no logo, old colours; theme → logo `<img>` in the configured corner on a video clip and absent on a `title` slide; caption uses brand background when `caption: 'brand'`; `title` layout shows company name.
- [ ] Commit `Draw slides, captions and the logo from the project's theme`.

### Task 5: Diagrams in theme colours

**Files:** Modify `src/main/slides/mermaidTheme.ts`, `src/main/slides/renderMermaidHeadless.ts`, `src/renderer/src/lib/renderMermaid.ts`, `src/renderer/src/lib/drawPendingDiagrams.ts`, `src/main/project/timeline/schema.ts` (`DiagramSceneDataSchema.themeStamp?: string`); Create `src/main/themes/redrawStaleDiagrams.ts`; Tests `src/main/slides/mermaidTheme.test.ts`, `src/main/themes/redrawStaleDiagrams.test.ts`

```ts
export function mermaidConfigFor(theme?: RenderTheme | null): MermaidConfig   // variants.dark → node colours, accent → borders, body font
export async function renderMermaidHeadless(source: string, theme?: RenderTheme | null): Promise<string>
export async function renderMermaid(source: string, theme?: RenderTheme | null): Promise<DiagramResult>   // re-initialise when the stamp changes
export function staleDiagrams(timeline: TimelineItem[], stamp: string | null): TimelineItem[]
export async function redrawStaleDiagrams(projectId: string, baseDir?): Promise<number>   // headless; used before export
```
- [ ] Tests: `mermaidConfigFor()` equals today's `MERMAID_CONFIG`; with a theme, `primaryBorderColor` is the accent and `fontFamily` the body family; `staleDiagrams` returns diagrams whose `themeStamp` differs (absent stamp counts as stale only when the project has a theme); `redrawStaleDiagrams` redraws and stores the new stamp (headless, 90 s).
- [ ] `drawPendingDiagrams(projectId, timeline, theme)` also redraws stale ones; Editor passes the theme. `renderProjectVideo` calls `redrawStaleDiagrams` first.
- [ ] Commit `Redraw diagrams in the theme's colours`.

### Task 6: Applying a theme, bookends, preview and export

**Files:** Modify `src/main/project/schema.ts` (`themeId?`, `bookendsAdded?`), `src/main/ipc/projectHandlers.ts`, `src/main/ipc/timelineHandlers.ts`, `src/preload/index.ts`, `src/renderer/src/api/projectClient.ts`, `src/renderer/src/screens/Editor.tsx`, `src/main/render/renderProject.ts`, `src/main/capture/recordSession.ts`; Create `src/main/themes/applyTheme.ts`; Tests `src/main/themes/applyTheme.test.ts`, `src/main/render/themedExport.test.ts`

```ts
export function setProjectTheme(projectId: string, themeId: string | null, baseDir?): ProjectMetadata
```
- First application adds a `scene` with `layout: 'title'` (title = project name) moved to position 1, and one with `layout: 'closing'` (title = tagline or company) at the end; sets `bookendsAdded`. Later changes and `null` add nothing.
- IPC: `project:setTheme` (wrapped in `withHistory`), `project:theme:render` → `toRenderTheme(project.themeId)`.
- Editor: fetch render theme on open and after theme changes; `inputProps={{ timeline, theme }}`.
- Export: `inputProps: { timeline, theme }` for `selectComposition` and `renderMedia`.
- Recording: `highlightScript({ accent: theme?.overlays.highlight ?? settings.highlightColour })`.
- [ ] Tests: bookends added once, at start and end, titles right; switching theme adds none; removing theme keeps the cards; export of a themed project with a title slide produces an MP4 (real render, 180 s).
- [ ] Commit `Apply a theme to a project, with opening and closing cards`.

### Task 7: Reading a brand — website, logo, brand guide

**Files:** Create `src/main/themes/generate/facts.ts` (types), `readWebsite.ts`, `readLogo.ts`, `readBrandGuide.ts`, fixtures `src/main/themes/generate/fixtures/{svg-logo,favicon-only,sign-in}.html`, `logo.png`, `brand-guide.pdf`; Tests alongside.

```ts
export interface BrandFacts {
  colours: { hex: string; weight: number; role: 'background'|'text'|'button'|'link'|'heading'|'logo'|'document' }[]
  fonts: { family: string; role: 'heading'|'body'|'document' }[]
  logo?: { bytes: Buffer; fileName: string }
  sources: ('website'|'logo'|'pdf'|'description')[]
  problems: string[]          // "acme.com asked for a sign-in"
}
export async function readWebsite(url: string, opts?: { allowFileUrls?: boolean }): Promise<BrandFacts>
export async function readLogo(bytes: Buffer, fileName: string): Promise<BrandFacts>
export async function readBrandGuide(bytes: Buffer): Promise<BrandFacts>
export function mergeFacts(...all: BrandFacts[]): BrandFacts
```
- readWebsite: headless chromium; `page.route('**', …)` aborts navigations other than the first document; 30 s; collects computed colours weighted by element area, `font-family` first names, logo candidate; sign-in detection reuses `authWall.ts`'s field test.
- [ ] Tests (headless, 60 s): svg-logo fixture → brand colour and font found, SVG logo returned; favicon-only → favicon logo; sign-in → `problems` mentions sign-in; a non-http URL refused without `allowFileUrls`; logo.png → its two dominant colours; PDF → hex codes and "Inter".
- [ ] Commit `Read a brand's colours, fonts and logo from a website, logo or guide`.

### Task 8: Proposing a theme, and fonts

**Files:** Create `src/main/themes/generate/proposeTheme.ts`, `ruleBasedTheme.ts`, `resolveFonts.ts`, `generateTheme.ts`; Tests alongside.

```ts
export async function proposeTheme(facts: BrandFacts, description: string, provider: NarrationProvider): Promise<ThemeDraft>
export function ruleBasedTheme(facts: BrandFacts, name: string): ThemeDraft
export async function resolveFonts(draft: ThemeDraft, fetcher?: typeof fetch): Promise<{ draft: ThemeDraft; files: { role: 'heading'|'body'; fileName: string; bytes: Buffer }[]; notes: string[] }>
export interface GenerateRequest { name: string; url?: string; description?: string; file?: { bytes: Buffer; fileName: string } }
export interface GenerateStatus { running: boolean; step: string; error?: string; result?: { draft: ThemeDraft; logo?: …; fonts: … } }
export function generateTheme(request: GenerateRequest): Promise<GeneratedTheme>
export function generateStatus(): GenerateStatus
```
- proposeTheme: prompt asks for JSON only matching the draft shape; parse first `{…}` block; validate; one retry with zod errors; then `ruleBasedTheme`. Template provider (no `complete`) → rules directly.
- resolveFonts: family → `ofl/<lower no spaces>/METADATA.pb` or `apache/…` on raw.githubusercontent.com/google/fonts/main; found → `fonts.googleapis.com/css2?family=<Family>:wght@400;600&display=swap` with a Chrome UA, download each woff2 url; not found → keep draft's fallback family (must itself be open, else built-in) and note. All failures → built-in with a note.
- generateTheme: steps "Reading <host>…", "Reading the logo…", "Choosing colours…", "Getting fonts…", "Checking readability…"; then `fixContrast`; provenance notes merged.
- [ ] Tests: fake provider valid JSON → its colours; invalid twice → rule-based; template provider → rule-based; resolveFonts with a fake fetch: Inter found under ofl → files; "Graphik" missing → fallback + note naming Graphik; fetch throwing → built-in + note.
- [ ] Commit `Propose a theme from a brand, with open fonts and readable colours`.

### Task 9: Themes in Settings and in About this project

**Files:** Create `src/renderer/src/components/themes/ThemesSection.tsx`, `ThemeEditor.tsx`, `CreateThemeDialog.tsx`, `ThemePicker.tsx` + tests; Modify `SettingsDialog.tsx` (section `themes`), `AboutProjectDialog.tsx` (picker), `Editor.tsx`, `src/main/ipc/projectHandlers.ts` (settings:themes:*), `src/preload/index.ts`, `src/renderer/src/api/projectClient.ts`.

IPC: `settings:themes:list`, `settings:themes:read`, `settings:themes:create`, `settings:themes:update`, `settings:themes:delete`, `settings:themes:usage`, `settings:themes:generate`, `settings:themes:generateStatus`, `settings:themes:addFont`, `settings:themes:setLogo`, `settings:themes:render` (draft → RenderTheme for the preview).
- Editor preview: the preview player playing a 4-clip sample timeline (brand, light, dark slides + a caption) with the draft's RenderTheme.
- [ ] Tests: list shows themes and both buttons; editor shows a failing contrast badge for a bad pair; save sends the draft; delete confirmation lists using projects; Create with AI shows steps while running and opens the editor with the draft; About-project picker calls `setTheme`.
- [ ] Commit `Manage themes in Settings, and choose one per project`.

### Task 10: MCP tools

**Files:** Modify `src/mcp/server.ts`, `src/main/agent/projectAgent.ts` (`AGENT_TOOLS`), Test `src/mcp/server.test.ts`
Tools: `talkie_list_themes`, `talkie_theme`, `talkie_create_theme` (fields or url/description → `generateTheme`, saved), `talkie_update_theme`, `talkie_delete_theme`, `talkie_apply_theme`.
- [ ] Tests for each, like the context tools. Commit `Let agents make, change and apply themes`.

### Task 11: Docs and packaged check

- [ ] AGENTS.md: a "Themes" section — where they live, data URLs not asset server (why), stamps on diagrams, bookends once.
- [ ] `npm run package:dir`; export a themed project from the packaged app's code path with cwd `/`; confirm fonts and logo appear (extract a frame with ffmpeg and view it).
- [ ] Full `npm test`, `npm run typecheck`; commit `Document themes`.
