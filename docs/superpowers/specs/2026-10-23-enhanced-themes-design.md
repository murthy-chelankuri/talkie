# Enhanced corporate themes — design

Date: 2026-10-23 · Branch: `feat/enhanced-themes` (to be stacked on `ui/ai-screens` after PR #64)

## Goal

A company with a strict brand should be able to hold Talkie to it. Today a theme carries one logo,
three colour variants, two fonts and two overlay choices. That is not enough for a corporate brand:
the logo differs on light and dark backgrounds, the brand prescribes background imagery for some
surfaces, there is an approved palette a video must not stray from, and some of this must be
_locked_ so neither a person's slip nor an AI edit quietly drifts off-brand.

This design extends the existing theme system in place — same folder-per-theme, same
`RenderTheme`, same sandbox — with: a two-slot logo (light/dark background), per-surface background
images, a brand palette, and coarse per-group locks with a warn-only compliance check. AI theme
generation grows to read a **local brand folder** (fonts, logos, imagery, brand-guide docs) as well
as a URL. Every dependent asset — logos, backgrounds, fonts — is copied into the theme folder, so a
Studio shared over git carries the whole brand with it.

## Decisions (agreed in brainstorming)

| Question | Decision |
|---|---|
| Approach | **A — extend in place.** Add typed fields to the existing schema (bump `THEME_SCHEMA_VERSION` 1→2), keep the folder layout, the `RenderTheme` data-URL inlining and the HTML-scene sandbox exactly as they are. No new asset route, no relaxed CSP. |
| What brand strictness covers | A **logo system** (light/dark-background logos, placement, clear-space, min-height); **background images** per surface; an **AI source that is a URL _or_ a local folder**; and **brand locks**. |
| Where backgrounds apply | **Cards and content slides.** Diagrams keep their solid themed background (a diagram is read for its structure; imagery behind it hurts legibility and invalidates the drawing cache). |
| Logo selection | **Light vs dark only.** Two slots; the renderer picks by the luminance of the surface the logo sits on. Not per-variant beyond that. |
| AI local source | **Rich folder + brand guide.** The folder may hold fonts, logo images, background imagery and brand-guide docs (PDF / md / txt); all are read and the relevant ones copied in. |
| Strictness model | **Lock + warn.** AI generation and contrast auto-fix never move a locked group; a compliance check lists violations as warnings in the editor and to agents, but nothing is ever blocked and a human can unlock/override at any time. |
| Image quality | **Store verbatim.** Background images are copied into the folder byte-for-byte — never re-encoded or downscaled — to preserve quality. At render they inline as data URLs with a ~12 MB safety ceiling that **warns** rather than silently degrading. |

## 1. Schema v2 (`src/main/themes/schema.ts`)

`THEME_SCHEMA_VERSION` goes 1 → 2. New and changed fields:

```ts
// LOGO_CORNERS unchanged: top-left | top-right | bottom-left | bottom-right
// VARIANT_IDS unchanged: brand | light | dark

logo?: {
  light?: { file: string },      // logo for light backgrounds (dark ink)
  dark?:  { file: string },      // logo for dark backgrounds (light ink)
  corner: LogoCorner,
  showOn: { recordings: boolean, slides: boolean },
  clearSpace?: number,           // multiples of logo height kept clear around it
  minHeight?: number             // px; below this the logo is too small to show
}

backgrounds?: {
  card?:    { brand?: BackgroundEntry, light?: BackgroundEntry, dark?: BackgroundEntry },
  content?: { brand?: BackgroundEntry, light?: BackgroundEntry, dark?: BackgroundEntry }
}
// BackgroundEntry = { file: string, fit: 'cover' | 'contain' | 'tile', scrim: number /* 0..1, default 0.35 */ }

brand?: { palette?: { name: string, hex: string }[] }

locks?: LockKey[]
// LockKey is a closed enum:
//   'variants.brand' | 'variants.light' | 'variants.dark' |
//   'fonts.heading' | 'fonts.body' | 'logo' | 'backgrounds'
```

- `ThemeLogoSchema` changes shape (single `file` → `light?`/`dark?` slots). **Migration v1→v2:**
  a v1 `logo: { file, corner, showOn }` becomes `logo: { light: { file }, dark: { file }, corner,
  showOn }` — the one logo serves both slots until the editor or AI fills them separately. A v1
  theme with no logo stays with no logo. `backgrounds`, `brand`, `locks` default to absent.
- Built-in themes (`builtinThemes.ts`, `builtin-*`) stay v2-shaped but carry no backgrounds, no
  palette, no locks, and a single logo mirrored into both slots — so they still work offline and
  bring no new licences. `builtinThemes.test.ts` is unaffected.
- `provenance` grows the ability to record which assets the AI placed and why (e.g. "logo-dark
  from logo-white.svg: light ink on transparent").

## 2. Storage (`src/main/themes/themeApi.ts`, `toRenderTheme.ts`)

Folder layout gains two subdirectories; fonts/ and theme.json are unchanged:

```
~/Talkie/Studio/Themes/<id>-<slug>/
  theme.json
  fonts/*.woff2 | *.woff | *.ttf | *.otf
  logos/light.<ext>   logos/dark.<ext>
  backgrounds/card-brand.<ext>  card-light.<ext>  card-dark.<ext>
              content-brand.<ext>  content-light.<ext>  content-dark.<ext>
```

- A single generalized copier replaces the logo/font special cases:
  `writeThemeAsset(target, kind, slot, fileName, bytes)` where `kind` is `'logo' | 'background' |
  'font'` and `slot` is the slot name (`light`/`dark` for a logo, `card-dark` etc. for a
  background, unused for a font). It writes into the right subdir, keeps the original extension,
  and removes any previous file in that slot so a slot holds one asset. `MAX_LOGO_BYTES` (2 MB)
  still guards logos; backgrounds get their own larger ceiling.
- **Stored verbatim.** Backgrounds (and logos) are written byte-for-byte — no re-encode, no
  downscale — per the quality requirement.
- `duplicateTheme` and the AI staging→folder promotion copy the whole folder (`cpSync`,
  recursive), so `logos/`, `backgrounds/` and `fonts/` travel with a duplicate or a saved draft.
- `toRenderTheme`/`renderThemeFrom` read every asset inside the folder to a data URL through the
  existing `readInside()` path-escape guard. New `MAX_BACKGROUND_BYTES` (~12 MB) ceiling: over it,
  the background is dropped from the render and a warning recorded (surfaced via compliance), never
  silently shrunk. `stillLogo()` still settles SVG logos.
- `themeStamp` folds in the logo and background slot paths plus a content hash of each, so swapping
  a background or logo invalidates cached diagrams/posters the same way a colour change does.

## 3. Rendering

- **`RenderTheme` (`src/composition/renderTheme.ts`)** mirrors the v2 schema: `logo` becomes
  `{ light?: string, dark?: string, corner, showOn, clearSpace?, minHeight? }` (data URLs), and a
  new `backgrounds` carries per-context/variant `{ url, fit, scrim }` (data URLs).
- **Logo selection is resolved on the composition side**, not in the sandbox. `logoUrlFor(theme,
  surfaceBackgroundHex)` picks `dark` vs `light` by the luminance of the surface the logo sits on
  (reusing the `luminance` helper from `contrast.ts`). `LogoMark`/`LogoOverlay` and
  `sceneThemeOf(theme, variant)` resolve to **one** URL before it reaches an HTML scene, so
  `SceneTheme.logo` stays a single data URL and the sandbox / `--talkie-logo` contract is unchanged.
- **Backgrounds, native scenes:** `backgroundFor(theme, context, variant)` returns the entry for a
  surface. A native `TextScene` paints in strict order: **solid variant background → image (at its
  `fit`) → a colour scrim at `scrim` opacity in the variant background colour → content**. So text
  and logo always sit on a controlled tone, never raw imagery.
- **Backgrounds, HTML scenes:** the runtime injects `--talkie-bg-image`, `--talkie-bg-fit` and
  `--talkie-bg-scrim` as CSS variables and paints the same solid→image→scrim layers _behind_ the
  page via an injected layer, so existing templates need no edits. Images come from the theme's own
  folder as data URLs, keeping `connect-src 'none'` intact.
- **Diagrams ignore backgrounds** — they keep their solid themed background; `diagramStamp` is
  untouched by this change.

## 4. AI ingestion (`src/main/themes/generate/`)

`GenerateRequest` grows `folder?: string` and `files?: { bytes, fileName }[]` alongside the existing
`url?`, `description?`, `file?`.

- **New `readBrandFolder.ts`** classifies a local directory's contents by type: fonts (→ the font
  path), logo images, background imagery, and docs (PDF via existing `readBrandGuide`, plus a new
  md/txt reader). Logo images are analysed for ink colour (reusing `readLogo`'s canvas sampling) and
  assigned to the `light` or `dark` slot; background images are tagged `card`/`content` by
  luminance and aspect. Everything read is copied into staging at full quality.
- **`readWebsite.ts`** is extended to harvest background-image candidates (hero/section images) from
  the one page it reads — still one page, no clicks.
- **`BrandFacts` (`facts.ts`)** grows `logos[]`, `backgrounds[]`, `palette[]` and freeform `rules[]`.
- **`proposeTheme.ts`** sets colours, fonts and palette via the LLM; logos and backgrounds are
  assigned heuristically (by the ink/luminance analysis above) with a provenance note for each.
- Contrast is fixed as today (`fixContrast`), fonts still resolve only from Google Fonts
  `ofl/`/`apache/`. **AI themes start unlocked.** The draft waits in `Themes/.drafts/<uuid>` and is
  promoted to a real folder on save, carrying every asset at full quality (`cpSync`).

## 5. Locking & compliance

**Locks are coarse, per group** (the `LockKey` enum in §1) with "frozen until unlocked" semantics:

- **Automation skips locked groups.** `fixContrast(draft, locks)` won't move a locked variant's
  colours; the AI update path (`generateTheme` / `talkie_update_theme`) discards proposed values for
  any locked group and keeps the existing ones. `fixContrast` returns `{ draft, notes, unresolved }`
  where `unresolved` is the set of locked-and-still-failing checks, which flow into
  `provenance.notes` and the compliance list.
- **The editor disables locked inputs** behind a visible per-group lock toggle; the human flips it
  off to edit. One click, reversible — strict in feel, never a dead end.

**`checkCompliance(theme) → { severity: 'warn', group, message }[]`** is a pure function, warnings
only, never blocking apply or export:

- **Contrast** — any variant role (heading/body/accent) below its WCAG floor vs its background
  (reuses `contrast.ts`), especially a locked variant `fixContrast` could not repair.
- **Scrim legibility** — a background whose `scrim` is below ~0.3 on a text-bearing surface.
- **Logo rules** — a corner inset tighter than `clearSpace`, or a rendered height below `minHeight`.
- **Off-palette** — with `brand.palette` set, a variant role colour that is not near any palette
  colour (small ΔE / RGB-distance threshold).
- **Missing counterpart logo** — variants span light _and_ dark but only one logo slot is filled.

Surfaced in: a live **Brand check** panel in the editor; `talkie_theme`'s read output and
`talkie_update_theme`'s response (same warnings for agents); and an optional non-blocking note at
apply time. Never gates export.

## 6. The MCP / IPC / editor surface

Additive throughout — existing tools and channels keep working; v2 adds fields and generalizes two
helpers. Nothing is renamed or removed.

**MCP tools:**
- `talkie_theme` (read) returns the v2 fields and the compliance-warnings list.
- `talkie_create_theme` / `talkie_update_theme` grow `logos: { light?, dark? }`, `backgrounds:
  [{ context: 'card' | 'content', variant: 'brand' | 'light' | 'dark', file | url, fit?, scrim? }]`
  (a flat list, each entry naming the surface it fills), `palette: [{ name, hex }]`, `locks: [...]`.
  Assets arrive as today (bytes + fileName, or a URL/path the main process fetches into the folder).
  Update respects locks: a locked group in the payload comes back rejected with a note rather than
  silently applied.
- The generate path (`talkie_create_theme` with a source) takes `folder?` and `files?[]` (§4). AI
  output starts unlocked.
- No new per-asset delete tool: an asset is replaced by setting a new one, or cleared by passing
  `null` for its slot in update; `talkie_delete_theme` still removes the whole folder. The
  five-verb rule (create/read/modify/remove/place) is satisfied per asset group without a tool
  explosion.

**IPC (`settings:themes:*`, `src/main/ipc/themeHandlers.ts`):**
- `addAsset` generalizes to `writeThemeAsset(target, kind, slot, fileName, bytes)` (§2);
  `addFont` / `fontFiles` unchanged.
- a new `compliance` channel → `checkCompliance(theme)` for the live editor panel.
- `render` returns the v2 `RenderTheme` (logo resolved per surface, background layers).
  `ThemeTarget` (`{ themeId } | { stagingDir } | null`) is unchanged.

**Editor UI (`src/renderer/src/components/themes/`):**
- **Logos** section: light-background and dark-background drop targets, corner picker, show-on
  toggles, optional clear-space / min-height.
- **Backgrounds** section: per context (card / content) × variant slot, each with a fit choice and
  a scrim slider; the live preview shows text over the image at the chosen scrim.
- **Brand palette** editor (name + hex rows), feeding the off-palette warning.
- a **lock toggle** per group (variants, fonts, logo, backgrounds); a locked group disables its
  inputs until toggled.
- a **Brand check** panel listing compliance warnings live as the draft changes.

## Testing

- Schema: a v1 theme (one logo, no backgrounds/locks) migrates to v2 with both logo slots filled;
  a v1 theme with no logo stays logo-less. `builtinThemes.test.ts` still passes.
- Storage: `writeThemeAsset` writes to the right subdir, replaces a slot's previous file, and stores
  bytes verbatim; `duplicateTheme` and draft promotion carry `logos/` and `backgrounds/`;
  `readInside` still refuses an escape; `themeStamp` changes when a background or logo is swapped.
- Rendering: `logoUrlFor` picks the dark logo on a dark surface and the light logo on a light one;
  a native text scene paints solid→image→scrim→content; an HTML scene receives the bg CSS vars and
  its sandbox attributes are unchanged; a diagram is drawn with no background image; a background
  over the inline ceiling is dropped with a warning, not shrunk.
- AI: `readBrandFolder` classifies fonts/logos/backgrounds/docs; an AI theme starts unlocked; a
  generated theme's assets are promoted at full byte size.
- Locking & compliance: `fixContrast` leaves a locked variant untouched and reports it as
  unresolved; the AI update path keeps a locked group; `checkCompliance` flags each violation class
  as a warning and nothing blocks export.
- MCP/IPC: `talkie_update_theme` rejects a locked group with a note; the `compliance` channel
  round-trips; the channel-parity test (handler + caller) still passes.

## Out of scope

- Per-variant logos beyond light/dark; animated backgrounds; video backgrounds.
- Hard gates that block export or apply (the model is warn-only by decision).
- Downscaling or re-encoding any asset (quality is preserved by decision).
- Backgrounds behind diagrams.
