# Studio redesign — design

Date: 2026-10-11 · Branch: `feature/studio-redesign` (stacked on `feature/html-scenes`, PR #20)
Supersedes the look of `2026-09-09-ui-redesign-design.md`; that spec's foundations — Tailwind,
CSS-variable tokens, the `ui/` primitives, renderer tests — stay.

## Goal

Make Talkie look and feel like a modern creative tool. Today every panel, card and button is
outlined, the left column is a stack of bordered cards, and controls sit in rows of bordered
squares. The redesign moves to depth instead of outlines, one vivid accent, and a layout built
around a rail, one open panel, the stage, an inspector and the timeline — without changing what
any feature does.

## Decisions (agreed in brainstorming, with mockups)

| Question | Decision |
|---|---|
| Direction | **Studio** — dark, borderless, layered surfaces, soft depth (Linear / Arc / Raycast territory) |
| Accent | **Violet → cyan gradient** for surfaces; a solid violet for text and outlines |
| Light mode | **Dark first, keep light** — Studio dark is the design target; a light Studio variant stays behind the switch |
| Type | **Serif + warm paper, as today** — Newsreader for headings and the script on paper; Inter for the interface |
| Layout | **Restructure** — icon rail (Project, Add, Voice, Agent) opening one panel at a time, a right-hand inspector for the selected clip |
| Home | Restyled grid, led by a "Continue where you left off" card |

## 1. Design system

### Tokens (`src/renderer/src/styles/index.css`)

| Token | Dark (default) | Light | For |
|---|---|---|---|
| `--color-bg` | `#0e0f13` | `#f3f4f8` | Window |
| `--color-surface` | `#17181e` | `#ffffff` | Panels, cards, timeline |
| `--color-raised` *(new)* | `#1d1f28` | `#eef0f5` | Rows, clips, button groups |
| `--color-surface-hover` | `#262836` | `#e6e9f0` | Hover and pressed |
| `--color-border` | `#23252f` | `#e1e4eb` | Dividers *inside* a panel only — never around one |
| `--color-text` | `#e9eaf0` | `#171b22` | |
| `--color-text-muted` | `#8b8ea3` | `#5d6675` | |
| `--color-accent` | `#a99fff` | `#4b37d0` | Links, selection rings, focus, small accent text |
| `--color-accent-gradient` *(new)* | `linear-gradient(90deg, #7c6cff, #4fc3ff)` | same | Primary buttons, play, active tab, rail selection, waveforms |
| `--color-on-gradient` *(new)* | `#0e0f13` | `#0e0f13` | Text and icons on the gradient |
| `--color-accent-soft` *(new)* | gradient at ~20% over `raised` | gradient at ~14% over `raised` | The tinted AI buttons |
| `--color-paper` / paper text | `#1e1b16` / `#ece3d2` | `#fdfbf6` / `#2a241b` | The script, unchanged in spirit |
| `--color-danger` | `#ef6470` | `#c0333f` | Recording and the playhead only, as now |
| `--color-success` | `#59b487` | `#1f7a52` | "Voiced" |

`--color-media` and `--color-slides` stay for the clip kind chips.

**Contrast, checked before writing:**
- `--color-accent` clears the project's **5.8:1** floor for 10–11 px accent text on every surface:
  dark 6.32–8.29, light 6.27–7.62. (`#5b47e0` was considered for light and failed at 5.05.)
- Body and muted text clear 4.5:1 on every surface. The lowest is muted on hover, at 4.51 dark
  and 4.77 light.
- **Text on the gradient is near-black, never white.** White on the cyan end is 1.98:1. Near-black
  is 4.97:1 at the violet end and 9.65:1 at the cyan end, so labels stay readable across the
  whole button.

### Shape, depth, type

- Radii: 12 px panels; 8–9 px rows, buttons, inputs; fully round pills.
- No outlines around panels, cards or buttons. Depth comes from the surface step (`bg` →
  `surface` → `raised`). Shadows only on what floats: dialogs, menus, the transport pill, popovers.
- Focus: a 2 px `--color-accent` ring with a 2 px offset — visible on every surface.
- Type: **Inter** (variable, served from `@fontsource-variable/inter` — no network) for the
  interface; **Newsreader** for headings and the script. Large numbers and headings use −0.02em
  tracking.

### Primitives (`src/renderer/src/components/ui/`)

- `Button` — variants `gradient` (new; primary), `soft` (new; AI actions), `secondary` (raised),
  `ghost`, `danger`. `primary` becomes `gradient`.
- `IconButton` — borderless; `raised` background on hover; optional `group` styling for clusters.
- `Card`, `Panel` — borderless surfaces.
- `Input`, `Textarea` — `raised` fields, no outline until focused.
- **New:**
  - `Rail` — a vertical strip of labelled icon buttons, one of them selected.
  - `SidePanel` — the one open panel: a title, a close button, a resizable width.
  - `Inspector` — the right-hand column, with sections and properties as key and value.
  - `Segmented` — the Brand / Light / Dark style picker.
  - `ButtonGroup` — a cluster of borderless icon buttons on one raised pill.

## 2. Screens

### Editor

```
┌ top bar: logo · project switcher ··········· Saved · [Export video] · ⚙ · ☾ ┐
│ rail │ side panel (one, optional) │       stage        │   inspector       │
│  ▤   │                            │   video            │   selected clip   │
│  ＋  │                            │  ( ▶ 0:15 ━━ ⤢ )   │   or the project  │
│  ◉   ├────────────────────────────┴────────────────────┴───────────────────┤
│  ✦   │  Timeline | Script      ✦ Write the words · Voice all · [↶ ↷ − ＋ ✂ 🗑] │
│      │  clips · waveforms · narration on paper                              │
└──────┴──────────────────────────────────────────────────────────────────────┘
```

- **Rail**:

  | Panel | Contents |
  |---|---|
  | Project | Today's `ProjectSummary`, "About this project", the theme, the sources list |
  | Add | Record a session (in danger red, since it records), Add a scene, Import slides, Add an image |
  | Voice | The project voice picker, voice-quality notes, Voice all |
  | Agent | `AskTheAgent`, unchanged in behaviour |

  - Clicking a rail item opens its panel; clicking it again, or pressing Esc, closes it.
  - ⌘1–⌘4 open the panels in order.
  - The panel resizes between 260 and 420 px.
  - The open panel and its width are remembered per device in `localStorage`. As with the theme
    switch, reads and writes are wrapped so that missing storage falls back to defaults.
  - The collapsible `SourcesPanel` column and the right-hand agent column are removed. Their
    content moves into these panels, and their accessible names stay where the controls stay.
- **Inspector**, resizable 240–380 px and collapsible. It follows the existing selection:

  | Selection | Shows |
  |---|---|
  | Video clip | Trimmed range, length, number of clicks, voice |
  | Slide, diagram, HTML scene | Look (`Segmented`), length, voice, Edit (opens the scene editor) |
  | Image | Length, voice |
  | Every clip | Re-voice, Write the words, Split at playhead, Delete; an HTML scene's check problems |
  | Nothing selected | The project: length, voiced count, theme, and a pointer to the Add panel when empty |

- **Stage**: the Player, with `TransportBar` restyled as a floating pill under it. Play uses the
  gradient. Volume and fullscreen stay in the pill.
- **Timeline / Script**:
  - The active tab gets a gradient underline.
  - The toolbar regroups: AI actions (`soft`) on the left, then one `ButtonGroup` holding undo,
    redo, zoom, split and delete.
  - Clips lose their outlines; the selected one gets a 2 px `--color-accent` ring.
  - Waveforms use the gradient.
  - Narration stays Newsreader on paper. `ClipNarrationBox` and `ScriptView` keep their behaviour.
- **Top bar**: logo (gradient mark), `ProjectSwitcher`, a "Saved" status, **Export video**
  (`gradient`, moved from the sources panel), Settings, the theme switch.

### Home (`ProjectBrowser`)

- A serif "Your projects" heading, with **New project** (`gradient`) beside it.
- A **"Continue where you left off"** card for the most recently changed project: poster, name,
  chips for clips, voiced status and age, and an "Open project" button.
- A grid of borderless cards for the rest, each with its length on a blurred tag over the poster.
  Delete appears on hover, with confirmation, as today.
- Empty, loading and error states are restyled the same way.

### Dialogs and the recording toolbar

- **Dialogs** keep their structure and change only their look: rounded `surface` panels on a
  blurred backdrop, borderless sections, `gradient` primary actions. This covers
  `SettingsDialog` (with Themes and Licences), `SceneEditor` (Slide, Diagram and HTML),
  `AboutProjectDialog`, `CreateThemeDialog` and the export summary.
- **Recording toolbar window** (`toolbar` renderer entry): a dark pill with the red record and stop
  controls, using the same tokens.

## 3. Not changing

- The video's own look: the Remotion composition follows the *project* theme, not the app's.
- Behaviour, IPC, data, and every security invariant (CSP, sandboxed HTML scenes, permissions).
- The September spec's foundations (Tailwind, tokens via CSS variables, `ui/` primitives,
  renderer tests).

## 4. Build order

1. **Tokens and fonts:** new dark and light values, gradient, raised, on-gradient; Inter installed.
   The app takes on the new colours at once.
2. **Primitives:** restyle `Button`, `IconButton`, `Card`, `Panel`, `Input` and `Textarea`; add
   `Rail`, `SidePanel`, `Inspector`, `Segmented` and `ButtonGroup`, each with tests.
3. **Editor structure:** rail, side panels and inspector replace the two side columns. Test the
   behaviour first: one panel at a time, Esc, ⌘1–4, remembered panel, the inspector following the
   selection, the empty-selection overview, Export starting from the top bar.
4. **Stage and timeline restyle.**
5. **Home.**
6. **Dialogs and the recording toolbar.**
7. **Visual check:** screenshot every screen from the built app in dark and light through
   Playwright's Electron driver, and look at each.

## 5. Testing

- Existing tests find controls by accessible name. Moved controls keep their names. Names that
  change because the control changed are updated deliberately, test by test.
- **Contrast test:** every text/background pair in both themes, accent text ≥ 5.8:1, body and
  muted text ≥ 4.5:1, text on the gradient checked at both ends. This replaces today's azure
  check.
- New behaviour tests as listed in step 3; rail and inspector keyboard and accessible names
  (`role="tablist"` / `aria-pressed`, labelled panels).
- `npm test` and `npm run typecheck` pass before every commit.

## 6. Documentation

- `index.css` design notes rewritten for Studio.
- The AGENTS.md accent rule ("azure… 5.8:1") rewritten for violet, the gradient, and near-black
  text on it.
- `2026-09-09-ui-redesign-design.md` marked as superseded in look, kept for its foundations.

## 7. Deviations decided while planning

- **Interface font stays Geist**, not Inter. The app already ships Geist, served locally; it is the
  same kind of face, and switching would add a dependency for no visible gain.
- **The inspector shows a recording's trimmed range, length and voice — not its click count.** The
  window has no way to read clicks today, and adding one would be a behaviour change.
- **The Project panel has no sources list.** None exists today; adding one would be new behaviour.
- **"Continue where you left off" uses the last project opened in this window**, remembered in
  `localStorage`, falling back to the newest. Projects record no last-changed time.
