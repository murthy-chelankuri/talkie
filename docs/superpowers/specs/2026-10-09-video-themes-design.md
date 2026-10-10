# Video themes — design

Date: 2026-10-09 · Branch: `feature/themes` (stacked on `feature/voice-quality`, PR #18)

## Goal

A video made for a company should look like that company. A **theme** is one brand definition —
colours, fonts, logo, opening and closing cards, overlays — that every scene, diagram and caption
in a video follows. Themes can be made by hand or by AI from a company's website, a description,
or a logo / brand guide.

## Decisions (agreed in brainstorming)

| Question | Decision |
|---|---|
| What a theme controls | Colours and fonts; logo on screen; opening and closing cards; recording overlays (caption bar, click highlight) |
| What AI works from | Website URL, a short description, an uploaded logo or brand-guide PDF — any combination |
| Where themes live | A library in `~/Talkie/Themes`; a project references one by id; editing a theme updates every project using it |
| Per-slide control | A slide picks a **variant** of the theme — `brand`, `light` or `dark` — plus alignment and size. No free colours. |
| Fonts | Open fonts (Google Fonts, OFL/Apache only) downloaded into the theme; plus the user's own font files, kept on their Mac and never shipped |
| Opening / closing cards | Real scenes added to the timeline the first time a theme is applied; editable, narratable, deletable |

## 1. The theme and where it lives

```
~/Talkie/Themes/<id>-<slug>/
  theme.json
  logo.svg | logo.png | logo.jpg | logo.webp
  fonts/*.woff2 | *.woff | *.ttf | *.otf
```

`theme.json` (zod schema `ThemeSchema`, `src/main/themes/schema.ts`):

```ts
{
  id, name, createdAt, schemaVersion,
  company: string,            // "Acme"
  tagline: string,            // "Payments for small firms"
  website: string,            // "acme.com", shown on the closing card
  variants: {                 // each: background, heading, body, accent (hex)
    brand: Variant, light: Variant, dark: Variant
  },
  fonts: {
    heading: FontChoice,      // { family, files: string[] (relative to the theme dir), source: 'google' | 'user' | 'builtin' }
    body: FontChoice
  },
  logo?: { file: string, corner: 'top-left'|'top-right'|'bottom-left'|'bottom-right',
           showOn: { recordings: boolean, slides: boolean } },
  overlays: { highlight: string /* hex */, caption: 'dark' | 'light' | 'brand' },
  provenance?: { from: ('website'|'description'|'logo'|'pdf')[], notes: string[] }
                              // what the AI used and what it changed ("darkened #9ad for contrast")
}
```

- `ProjectMetadataSchema` gains `themeId?: string`. Absent means today's look, unchanged.
- `SceneStyleSchema.theme` becomes `z.enum(['brand','light','dark'])`, with a preprocess mapping
  the old values: `graphite`, `ink` → `dark`; `paper` → `light`; `brass` → `brand`. `font` and
  `accent` stay in the schema for old projects but are ignored when a theme is set.
- Without a theme, the variants resolve to today's palettes (dark → graphite, light → paper,
  brand → brass), and `font`/`accent` keep working exactly as now. Existing videos render
  identically.
- Text scenes gain `layout: 'standard' | 'title' | 'closing'` (default `standard`).
- Storage API (`src/main/themes/themeApi.ts`): `listThemes`, `readTheme`, `createTheme`,
  `updateTheme`, `deleteTheme`, `setProjectTheme`, plus `writeThemeAsset` for the logo and font
  files. Same patterns as `projectApi`: atomic JSON writes, ids are UUIDs, folder is
  `<id>-<slug>`.

## 2. Rendering

- **Theme travels with the timeline.** The composition receives `{ timeline, theme }`, where
  `theme` is a `RenderTheme`: the project's theme with its logo and font files embedded as data
  URLs (logo ≤ 2 MB, fonts ≤ 3 MB in all). Not asset-server URLs: that server is rooted at the
  projects folder, and widening it to `~/Talkie` would put `settings.json` — API keys — in reach
  of anything holding a URL. A `ThemeContext` provides it to every item. The preview gets it
  over `project:theme:render`; the export builds it the same way. One function, `toRenderTheme`,
  makes it for both.
- **`resolveSceneTheme(style, theme)`** returns the variant's colours and the theme's fonts, or
  today's palettes when `theme` is absent.
- **Fonts.** A `ThemeFonts` component injects `@font-face` rules for the theme's files and holds
  the frame with `delayRender` until `document.fonts.load` resolves for both families. A
  missing file falls back to the built-in families rather than failing the render.
- **Slides** (`TextScene`): colours and fonts from the variant. `layout: 'title'` draws the logo
  large, the company name and the project name; `layout: 'closing'` draws the logo, tagline and
  website.
- **Diagrams.** Mermaid bakes colours into the SVG, so drawing takes theme-derived
  `themeVariables` (`mermaidConfigFor(theme)`, replacing the fixed `MERMAID_THEME`). A diagram's
  data records `themeStamp` (hash of the theme's colours and fonts) when drawn. A diagram whose
  stamp does not match the project's current theme is redrawn: in the window by
  `drawPendingDiagrams` when the project opens, and in main by `renderMermaidHeadless` before
  export. The diagram font is the theme's body font, embedded as a data URL as Geist is now.
- **Captions.** `CaptionOverlay` takes the theme: `dark` (today's look, theme body font),
  `light`, or `brand` (brand variant background).
- **Logo.** A `LogoOverlay` above each clip, in the theme's corner, on the clip kinds `showOn`
  allows; never on `title`/`closing` slides. Rendered with `<Img>`, never inline SVG — a logo
  fetched from a website is untrusted markup, and an image element does not run scripts.
- **Click highlight.** Drawn into the page while recording (`highlightScript`), so it is part of
  the footage. A project's theme sets the colour for **new recordings only**; Settings says so.
- **Bookends.** `setProjectTheme` adds a `title` slide at the start and a `closing` slide at the
  end **only the first time a project gets a theme** (recorded as `bookendsAdded: true` in
  project.json). Later theme changes restyle them and never add more. Both are one undo step.

## 3. Editor and AI flow

**Where:** Settings → **Themes** (new sidebar section): list of themes with *New theme* and
*Create with AI*; selecting one opens the editor. **About this project** gains a theme picker.

**Editor** (`ThemeEditor.tsx`): left — company, tagline, website; colour swatches for each
variant with a contrast score (passes / fails); heading and body font, each with *add font
file*; logo with corner and where shown; highlight colour; caption style. Right — live preview
drawn with the real composition components through `@remotion/player`: a standard slide in each
variant, the opening card, a caption bar and a small diagram. Changes are a draft until *Save*.

**Create with AI** (`CreateThemeDialog.tsx`): website, description, file — any combination.
Progress is shown as named steps. The result opens in the editor, unsaved.

**Pipeline** (`src/main/themes/generate/`, all in main):

1. `readWebsite(url)` — headless Playwright, the recording browser. Loads the page (30 s cap),
   never clicks, types or follows links, blocks downloads. Collects: computed `background-color`
   / `color` of `body`, `header`, `nav`, buttons, links and headings, weighted by on-screen area;
   `font-family` of headings and body; the logo — first of an `<svg>` or `<img>` in the header
   whose label or file name says logo, `og:image`, `apple-touch-icon`, favicon. The logo is
   downloaded (≤ 2 MB; svg/png/jpeg/webp only).
2. `readLogo(file)` — sample the image's dominant colours on a canvas in the same headless
   browser (k-means, 5 colours, transparent pixels ignored).
3. `readBrandGuide(pdf)` — text via pdfjs (`rasterisePdf.ts`'s loader); pull hex codes
   (`#[0-9a-f]{6}`) and anything following "font" / "typeface".
4. `proposeTheme(facts, description)` — the configured narration provider's `complete()` gets the
   collected facts and returns theme JSON; validated with `ThemeDraftSchema`; one retry with
   the validation errors. With the `template` provider, or on a second failure,
   `ruleBasedTheme(facts)` builds one: most-covered saturated colour → brand, near-white →
   light, near-black → dark, highest-contrast saturated → accent.
5. `resolveFonts(draft)` — for each family, look it up in the Google Fonts repository under
   `ofl/` or `apache/` only; if found, download the `.woff2` files via the css2 API into the
   theme. If not (a commercial font), use the draft's open fallback and record a provenance note
   ("Acme uses Graphik (commercial). Using Inter — add your own font files for the real one").
   No network or a failed download → built-in fonts, with a note and *Try again* in the editor.
6. `fixContrast(theme)` — for each variant, heading and body against background must reach
   4.5:1 (heading 3:1), accent as a mark 3:1. Failing colours are moved in lightness (OKLCH)
   until they pass; each change is a provenance note.

**MCP / Ask Talkie** — five verbs, per AGENTS.md: `talkie_list_themes`, `talkie_theme` (read),
`talkie_create_theme` (fields, or `url` / `description` through the pipeline), `talkie_update_theme`,
`talkie_delete_theme`, and `talkie_apply_theme` (to a project). Added to `AGENT_TOOLS`.

IPC (`settings:*` for the library, `project:*` for applying): `settings:themes:list`, `:read`,
`:create`, `:update`, `:delete`, `:generate`, `:generateStatus`, `:addFont`, `:setLogo`;
`project:setTheme`.

## 4. Errors

| Situation | Behaviour |
|---|---|
| Site fails, needs sign-in, or times out | Continue with the other inputs; if none, say why and suggest a description or logo |
| AI output invalid | One retry with the errors; then the rule-based theme. A draft always results. |
| Font download fails / offline | Built-in fonts, a note, *Try again* |
| Theme deleted while in use | Confirmation lists the projects; they fall back to the default look |
| Logo or font file missing | Render without it; never fail an export over a theme |
| Old project, no theme | Renders exactly as today |

## 5. Testing

- Schema, storage, old-style mapping, fallbacks (`themeApi.test.ts`, `schema.test.ts`).
- `fixContrast` against known failing and passing pairs.
- `readWebsite` against local fixture pages (SVG logo in header; favicon only; sign-in page),
  headless, ≥ 60 s timeouts as for other browser tests.
- `readLogo`, `readBrandGuide` against small fixtures.
- `proposeTheme` with a fake provider returning valid JSON, invalid JSON, nothing; and the
  template-provider path.
- Rendering: each variant, title/closing layouts, captions and logo placement read the theme; a
  project without a theme renders as before; a stale `themeStamp` triggers a redraw.
- `ThemeEditor`, `CreateThemeDialog`, the Settings section, the About-project picker.
- MCP: every theme tool, like the context tools.
- Packaged build: theme fonts and logo render in an export with the app launched from `/`.

## Out of scope

Animated intros; per-scene free colours; brand voice/tone (narration already has project
context); themes for the app's own UI.
