# Studio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle Talkie in the Studio look (dark-first, borderless, violet→cyan accent) and restructure the editor around a rail, one side panel, the stage, an inspector and the timeline — without changing any behaviour.

**Architecture:** New tokens in `index.css` drive everything through Tailwind's CSS-variable colours, so most screens change by token alone; primitives in `components/ui/` carry the remaining look. The editor's two side columns become a `Rail` + one `SidePanel` (Project / Add / Voice / Agent, split out of today's `SourcesPanel` and `AskTheAgent`) and a new `Inspector`. Export moves to the top bar through a slot `AppShell` provides.

**Tech Stack:** React, Tailwind (CSS-variable tokens), react-resizable-panels, lucide-react, Vitest + Testing Library (jsdom), Playwright's Electron driver for the visual check.

**Spec:** `docs/superpowers/specs/2026-10-11-studio-redesign-design.md`

## Global Constraints

- Dark is the default and the design target; light stays behind the switch. Both themes get every token.
- Accent text/outlines: `--color-accent` = `#a99fff` dark, `#4b37d0` light. Gradient: `linear-gradient(90deg, #7c6cff, #4fc3ff)`. **Text on the gradient is `#0e0f13`, never white.**
- Contrast floors: accent text ≥ **5.8:1** on every surface; body and muted text ≥ **4.5:1**.
- No outlines around panels, cards or buttons; `--color-border` only for dividers inside a panel. Shadows only on what floats.
- Red (`--color-danger`) only for recording and the playhead; green (`--color-success`) for "voiced".
- Headings and the script stay Newsreader; narration stays on `--color-paper`.
- Moved controls keep their accessible names. No behaviour, IPC or data changes. Security invariants untouched.
- British spelling; comments say why; tests describe behaviour; `npm test` and `npm run typecheck` pass before each commit.

**Deviations from the spec, deliberate:**
- **Interface font stays Geist**, not Inter. The app already ships Geist (`@fontsource-variable/geist`), served locally. It is the same kind of face, and switching would add a dependency for no visible gain.
- **The inspector shows a recording's trimmed range, length and voice, not its click count.** The window has no IPC for clicks today, and adding one is a behaviour change this redesign rules out.
- **The Project panel has no sources list.** No such list exists today, so it would be new behaviour.
- **"Continue where you left off"** uses the last project opened in this window, remembered in `localStorage` (`talkie.lastProject`), falling back to the newest. Projects record no last-changed time.

The spec is updated with these in Task 1.

---

## File map

| File | Change |
|---|---|
| `src/renderer/src/styles/index.css` | Studio tokens, both themes; design notes rewritten |
| `tailwind.config.ts` | `raised`, `on-gradient`, `bg-accent-gradient`, `accent-soft` |
| `src/renderer/src/styles/contrast.test.ts` | New: every token pair against the floors |
| `src/renderer/src/components/ui/*` | Restyle; new `ButtonGroup`, `Segmented`, `Rail`, `SidePanel` |
| `src/renderer/src/components/editor/ProjectPanel.tsx`, `AddPanel.tsx`, `VoicePanel.tsx` | New: split from `SourcesPanel.tsx` |
| `src/renderer/src/components/editor/ExportControl.tsx` | New: Export in the top bar, with the exported card and error |
| `src/renderer/src/components/editor/Inspector.tsx` | New |
| `src/renderer/src/components/editor/useRailPanel.ts` | New: which panel is open, remembered, ⌘1–4, Esc |
| `src/renderer/src/components/AppShell.tsx` | Top-bar actions slot (`TopBarSlot`) |
| `src/renderer/src/screens/Editor.tsx` | Rail + panel + stage + inspector; removes the two side columns |
| `src/renderer/src/components/SourcesPanel.tsx` (+ test) | Removed once split; tests move to the new panels |
| `src/renderer/src/components/TransportBar.tsx`, `Timeline.tsx` | Restyle |
| `src/renderer/src/screens/ProjectBrowser.tsx` | Restyle + "Continue where you left off" |
| Dialogs, `src/renderer/toolbar.html` | Restyle |
| `AGENTS.md`, `docs/superpowers/specs/2026-09-09-ui-redesign-design.md` | Accent rule; superseded note |

---

### Task 1: Studio tokens and the contrast test

**Files:** Modify `src/renderer/src/styles/index.css`, `tailwind.config.ts`, the spec (deviations). Create `src/renderer/src/styles/contrast.test.ts`.

**Interfaces — Produces** Tailwind colours `raised`, `on-gradient`, `accent-soft-from`; background image `bg-accent-gradient`, `bg-accent-soft`; CSS vars `--color-raised`, `--color-accent-gradient`, `--color-on-gradient`, `--color-accent-soft`.

- [ ] **Step 1: Failing test** — `contrast.test.ts` reads `index.css`, parses both theme blocks, and checks:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const css = readFileSync(join(__dirname, 'index.css'), 'utf-8')
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]))
}
const lum = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe.each([[':root', 'light'], ["[data-theme='dark']", 'dark']])('the %s (%s) theme', (selector) => {
  const t = block(selector.startsWith('[') ? `:root${selector}` : selector)
  const surfaces = ['color-bg', 'color-surface', 'color-raised', 'color-surface-hover']
  it('sets accent text clear of 5.8:1 on every surface', () => {
    for (const s of surfaces) expect(ratio(t['color-accent'], t[s]), s).toBeGreaterThanOrEqual(5.8)
  })
  it('sets body and muted text clear of 4.5:1 on every surface', () => {
    for (const s of surfaces) {
      expect(ratio(t['color-text'], t[s]), s).toBeGreaterThanOrEqual(4.5)
      expect(ratio(t['color-text-muted'], t[s]), s).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('sets the script readable on paper', () => {
    expect(ratio(t['color-paper-text'], t['color-paper'])).toBeGreaterThanOrEqual(4.5)
  })
})

it('sets text on the gradient readable at both of its ends', () => {
  const ink = block(':root')['color-on-gradient']
  for (const end of ['#7c6cff', '#4fc3ff']) expect(ratio(ink, end), end).toBeGreaterThanOrEqual(4.5)
})
```

- [ ] **Step 2: Run** — `npx vitest run src/renderer/src/styles/contrast.test.ts` → FAIL (`color-raised` missing).

- [ ] **Step 3: Tokens** — replace both blocks in `index.css` (keep every existing token name; add the new ones):

```css
/*
 * Studio: depth instead of outlines, and one vivid accent.
 *
 * Panels are told apart by stepping up through three surfaces — bg, surface, raised — rather than
 * by lines round them; --color-border is for dividers inside a panel and nothing else. The accent
 * is a violet-to-cyan gradient on what you act on and on anything AI or voice, with a solid violet
 * for text and outlines, since a gradient cannot be set as small type. Text on the gradient is
 * near-black: white falls to 2:1 at the cyan end. Red is still only for what is live — recording
 * and the playhead — and the script keeps its warm paper, because writing is a different act.
 * src/renderer/src/styles/contrast.test.ts holds every pairing to its floor.
 */
:root {
  --color-bg: #f3f4f8;
  --color-surface: #ffffff;
  --color-raised: #eef0f5;
  --color-surface-hover: #e6e9f0;
  --color-border: #e1e4eb;
  --color-text: #171b22;
  --color-text-muted: #5d6675;
  --color-accent: #4b37d0;
  --color-accent-hover: #3d2bb3;
  --color-accent-foreground: #ffffff;
  --color-accent-gradient: linear-gradient(90deg, #7c6cff, #4fc3ff);
  --color-on-gradient: #0e0f13;
  --color-accent-soft: linear-gradient(90deg, rgba(124, 108, 255, 0.14), rgba(79, 195, 255, 0.12));
  --color-paper: #fdfbf6;
  --color-paper-text: #2a241b;
  --color-paper-border: #e4dccb;
  --color-danger: #c0333f;
  --color-danger-bg: #fdf1f2;
  --color-success: #1f7a52;
  --color-media: #0f766e;
  --color-slides: #6d28d9;
  color-scheme: light;
}

:root[data-theme='dark'] {
  --color-bg: #0e0f13;
  --color-surface: #17181e;
  --color-raised: #1d1f28;
  --color-surface-hover: #262836;
  --color-border: #23252f;
  --color-text: #e9eaf0;
  --color-text-muted: #8b8ea3;
  --color-accent: #a99fff;
  --color-accent-hover: #c2baff;
  --color-accent-foreground: #0e0f13;
  --color-accent-gradient: linear-gradient(90deg, #7c6cff, #4fc3ff);
  --color-on-gradient: #0e0f13;
  --color-accent-soft: linear-gradient(90deg, rgba(124, 108, 255, 0.2), rgba(79, 195, 255, 0.18));
  --color-paper: #1e1b16;
  --color-paper-text: #ece3d2;
  --color-paper-border: #342f26;
  --color-danger: #ef6470;
  --color-danger-bg: #2a1518;
  --color-success: #59b487;
  --color-media: #5eead4;
  --color-slides: #c4b5fd;
  color-scheme: dark;
}
```

Check `#a99fff` hover and accent-foreground pairings (`bg-accent text-accent-foreground`) by eye: `#0e0f13` on `#a99fff` is 8.3:1; `#ffffff` on `#4b37d0` is 7.9:1.

`tailwind.config.ts` `colors`: add `raised: 'var(--color-raised)'`, `'on-gradient': 'var(--color-on-gradient)'`, `'paper-text': 'var(--color-paper-text)'`; add `backgroundImage: { 'accent-gradient': 'var(--color-accent-gradient)', 'accent-soft': 'var(--color-accent-soft)' }`.

Default theme: `useTheme` defaults to the OS preference today — change the first-launch default to `'dark'` (a stored choice still wins). Update its test.

- [ ] **Step 4: Run** the contrast test, `src/renderer`, typecheck → PASS.
- [ ] **Step 5: Spec** — add the "Deviations" list above to the spec's end.
- [ ] **Step 6: Commit** — `Studio tokens: depth over outlines, a violet-to-cyan accent, dark first`.

---

### Task 2: Primitives

**Files:** Modify `ui/Button.tsx`, `IconButton.tsx`, `Card.tsx`, `Panel.tsx`, `Input.tsx`, `Textarea.tsx`, `Toolbar.tsx`, `EmptyState.tsx` and their tests. Create `ui/ButtonGroup.tsx`, `ui/Segmented.tsx`, `ui/Rail.tsx`, `ui/SidePanel.tsx` with tests.

**Interfaces — Produces:**

```ts
type ButtonVariant = 'primary' | 'gradient' | 'soft' | 'secondary' | 'ghost' | 'icon' | 'danger'
// 'primary' is kept as an alias of 'gradient' so no call site has to change.
function ButtonGroup(props: HTMLAttributes<HTMLDivElement> & { 'aria-label': string }): JSX.Element // role="group"
function Segmented<T extends string>(props: { label: string; value: T; options: { id: T; label: string }[]; onChange: (id: T) => void }): JSX.Element
interface RailItem { id: string; label: string; icon: ReactNode; shortcut?: string }
function Rail(props: { label: string; items: RailItem[]; selected: string | null; onSelect: (id: string) => void }): JSX.Element
function SidePanel(props: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }): JSX.Element
```

- [ ] **Step 1: Failing tests**
  - `Button` `gradient`/`primary` uses `bg-accent-gradient text-on-gradient`, and `soft` uses `bg-accent-soft`.
  - `IconButton` has no `border` class.
  - `ButtonGroup` renders `role="group"` with its label.
  - `Segmented` renders `role="radiogroup"` with `aria-checked`, and calls `onChange` on click and on arrow keys.
  - `Rail` renders `role="tablist" aria-orientation="vertical"` with one `role="tab"` per item; the selected item has `aria-selected="true"`; clicking calls `onSelect(id)`; `title` includes the shortcut.
  - `SidePanel` renders `role="region"` labelled by its title, and the close button is named `Close <title>`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Classes:
  - `Button` base: `rounded-[9px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg`.
  - Variants:

    | Variant | Classes |
    |---|---|
    | `gradient` | `bg-accent-gradient text-on-gradient hover:brightness-110` |
    | `soft` | `bg-accent-soft text-accent ring-1 ring-inset ring-accent/35 hover:brightness-125` |
    | `secondary` | `bg-raised text-text hover:bg-surface-hover` |
    | `ghost` | `bg-transparent text-text hover:bg-raised` |
    | `icon` | `bg-transparent text-text-muted hover:bg-raised hover:text-text` |
    | `danger` | `bg-danger text-white hover:brightness-110` |

  - `Card`: `rounded-xl bg-surface p-4`.
  - `Panel`: `rounded-xl bg-surface`, with its header divider in `border-border`.
  - `Input` / `Textarea`: `rounded-[9px] bg-raised border-0 … focus:ring-2 focus:ring-accent`.
  - `Toolbar`: no border.
  - `ButtonGroup`: `inline-flex items-center gap-0.5 rounded-[10px] bg-raised p-0.5`.
  - `Rail`: 52 px wide column. Each item is a 36 px square `IconButton`-style tab with an 8 px label below. Selected: `bg-accent-soft text-text ring-1 ring-inset ring-accent/50`.
  - `SidePanel`: `flex h-full flex-col rounded-xl bg-surface`; header `px-4 py-3` with the title (13 px semibold) and close `IconButton`; body `min-h-0 flex-1 overflow-y-auto px-4 pb-4`.
- [ ] **Step 4: Run** `src/renderer` (fix tests that asserted old classes, deliberately) and typecheck → PASS.
- [ ] **Step 5: Commit** — `Restyle the primitives for Studio, and add a rail, side panel, segmented control and button group`.

---

### Task 3: Split the sources panel into Project, Add and Voice, and Export into the top bar

**Files:**
- Create `components/editor/ProjectPanel.tsx`, `AddPanel.tsx`, `VoicePanel.tsx`, `ExportControl.tsx` and `editor/panels.test.tsx`.
- Modify `AppShell.tsx` (slot) + `AppShell.test.tsx`.
- Delete `SourcesPanel.tsx` and `SourcesPanel.test.tsx` after porting. Keep `Action` and `ProjectSummary` by moving them to `editor/`.

**Interfaces:**
- **Consumes:** `SourcesPanel`'s existing props, split by concern.
- **Produces:**

```ts
function ProjectPanel(props: { project: ProjectMetadata; totalFrames: number; clipCount: number; narrated: number; hasContext: boolean; onEditContext: () => void }): JSX.Element
function AddPanel(props: { recording: boolean; importingDeck: boolean; deckProgress: string | null; isEmpty: boolean; importError: string | null; recordError: string | null; onRecordSession: () => void; onImportImage: () => void; onAddScene: () => void; onImportDeck: () => void }): JSX.Element
function VoicePanel(props: { timeline: TimelineItem[]; progress: VoiceProgress; currentVoice: string; fidelityNote: FidelityNote | null; onKeepProjectVoice?: () => void; projectVoice: string | null; appVoice: string; voices: Voice[]; onProjectVoiceChange: (voice: string | null) => void }): JSX.Element
function ExportControl(props: { exporting: boolean; exportedPath: string | null; exportError: string | null; onExport: () => void; onDismiss: () => void }): JSX.Element
// AppShell
const TopBarSlot: React.Context<HTMLElement | null>
function TopBarActions({ children }: { children: ReactNode }): JSX.Element | null // portals into the slot
```

- [ ] **Step 1: Port the tests.** Move every `SourcesPanel.test.tsx` case to the panel that now owns it, unchanged in intent. Delete the two cases that are about the column itself ("asks to be collapsed", "offers a way back when collapsed", "keeps every action reachable when collapsed to a rail", "gives up the project details… when collapsed"): the rail replaces that column. Add:
  - `ExportControl` offers "Export video", is busy and disabled while exporting, and shows the exported card and the export error.
  - `TopBarActions` renders into `AppShell`'s top bar, before Settings.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - Move the JSX blocks from `SourcesPanel` verbatim into the three panels, with the outlines (`border border-border`) removed. `Action` rows become `bg-raised rounded-[10px]`; the record row keeps the danger tone.
  - `AppShell` gets `const [slot, setSlot] = useState<HTMLElement | null>(null)` and `<span ref={setSlot} className="flex items-center gap-2" />` before Settings, and provides `TopBarSlot`. `TopBarActions` is `createPortal(children, slot)` when the slot exists.
  - `ExportControl`: a `Button variant="gradient"` with `aria-label`/text "Export video" ("Exporting video" while busy). The exported card and the error sit in a popover anchored under it (`absolute right-0 top-full mt-2 w-80 rounded-xl bg-surface shadow-2xl`).
- [ ] **Step 4: Run** `src/renderer`, typecheck → PASS. (`Editor` still renders `SourcesPanel` until Task 4, so keep `SourcesPanel.tsx` until then, assembled from the three panels plus `ExportControl`. Delete it in Task 4.)
- [ ] **Step 5: Commit** — `Split the sources panel into project, add and voice panels, and put Export in the top bar`.

---

### Task 4: The editor's rail and side panel

**Files:**
- Create `components/editor/useRailPanel.ts` + test, `components/editor/EditorRail.tsx` + test.
- Modify `screens/Editor.tsx` and `components/AskTheAgent.tsx` (accept `onClose`; the collapsed mode stays only for its tests).
- Delete `SourcesPanel.tsx`.

**Interfaces — Produces:**

```ts
type RailPanelId = 'project' | 'add' | 'voice' | 'agent'
function useRailPanel(): { open: RailPanelId | null; toggle: (id: RailPanelId) => void; close: () => void }
// remembers `open` in localStorage 'talkie.railPanel' (try/catch); ⌘1–⌘4 toggle in order; Esc closes
// unless focus is in an input, textarea or contenteditable, or a dialog is open
function EditorRail(props: { open: RailPanelId | null; onToggle: (id: RailPanelId) => void }): JSX.Element
```

- [ ] **Step 1: Failing tests**
  - Starts closed with nothing stored, and opens the stored panel when there is one.
  - Opening one panel closes the other; toggling the open one closes it.
  - ⌘2 opens Add; Esc closes, but not while typing in a textarea.
  - A storage read that throws falls back to closed.
  - `EditorRail` names its tabs Project, Add, Voice and Agent, with shortcuts in their titles.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `useRailPanel`, `EditorRail`, then the layout in `Editor.tsx`:**

```tsx
<div className="flex h-full gap-2 bg-bg p-2 pl-0">
  <EditorRail open={rail.open} onToggle={rail.toggle} />
  <Group orientation="vertical" ...stageLayout className="min-w-0 flex-1">
    <ResizablePanel id="stage" defaultSize="62" minSize="25">
      <Group orientation="horizontal" ...railLayout className="h-full gap-2">
        {rail.open && (
          <ResizablePanel id="side" defaultSize={300} minSize={260} maxSize={420}>
            <SidePanel title={RAIL_TITLES[rail.open]} onClose={rail.close}>
              {rail.open === 'project' && <ProjectPanel … />}
              {rail.open === 'add' && <AddPanel … />}
              {rail.open === 'voice' && <VoicePanel … />}
              {rail.open === 'agent' && <AskTheAgent projectId={projectId} onClose={rail.close} onChanged={…} />}
            </SidePanel>
          </ResizablePanel>
        )}
        <ResizablePanel id="demo" minSize="30">{/* stage, unchanged inside */}</ResizablePanel>
        <ResizablePanel id="inspector" collapsible defaultSize={280} minSize={240} maxSize={380}>
          {/* Task 5 */}
        </ResizablePanel>
      </Group>
    </ResizablePanel>
    <Separator className="h-2 bg-transparent" />
    <ResizablePanel id="timeline">{/* unchanged */}</ResizablePanel>
  </Group>
</div>
```

  - `RAIL_TITLES = { project: 'Project', add: 'Add to the video', voice: 'Voice', agent: 'Ask the agent' }`.
  - `<TopBarActions><ExportControl … /></TopBarActions>` renders once in `Editor`.
  - Remove `sourcesCollapsed`, `agentCollapsed`, `agentPanel` and `agentLayout`.
  - Keep the agent's conversation state where it lives today (inside `AskTheAgent`). Closing the panel unmounts it, so **lift the conversation turns into `Editor` state** (`agentTurns`, `setAgentTurns`) and pass them in. A closed panel must not lose the conversation, as the column's comment warns. `AskTheAgent` gets `turns`/`onTurns` props; its test covers that the conversation survives being closed and reopened.
- [ ] **Step 4: Run** `src/renderer`, typecheck → PASS. Start `npm run dev` and look at the editor once.
- [ ] **Step 5: Commit** — `Put the editor's panels behind a rail, one at a time`.

---

### Task 5: The inspector

**Files:** Create `components/editor/Inspector.tsx`, `components/editor/inspector.test.tsx`. Modify `Editor.tsx`.

**Interfaces:**
- **Consumes:**
  - `selectedItemId`, `timeline`, `segments`, `progress`, `voice`, `renderTheme`, `playerRef`.
  - Handlers: `handleNarrate(item)`, `handleDraft(item)`, `handleSplit(item, atFrame)`, `handleDeleteClip(item)`, `setSceneEditing(item)`.
  - `sceneClient.update`, `htmlSceneClient.edit`, `drawPendingDiagrams`.
- **Produces:**

```ts
function Inspector(props: {
  item: TimelineItem | null
  timeline: TimelineItem[]
  segments: TranscriptSegment[]
  progress: VoiceProgress
  voice: string
  theme: RenderTheme | null
  playheadFrame: () => number
  busy: { narrating: boolean; drafting: boolean }
  onEdit: (item: TimelineItem) => void
  onLook: (item: TimelineItem, look: 'brand' | 'light' | 'dark') => Promise<void>
  onNarrate: (item: TimelineItem) => void
  onDraft: (item: TimelineItem) => void
  onSplit: (item: TimelineItem, atFrame: number) => void
  onDelete: (item: TimelineItem) => void
}): JSX.Element
```

- [ ] **Step 1: Failing tests** (jsdom):
  - With nothing selected it shows the project: total length, "N of M voiced", the theme's name or "Talkie's own look".
  - A slide shows its title, "Clip 2 of 5", Look (`Segmented`) set to its variant, length and voice. Choosing Light calls `onLook(item, 'light')`.
  - A recording shows its trimmed range (`0:04–0:19`) and no Look.
  - An HTML scene lists its check problems.
  - Re-voice, Write the words, Split at playhead (using `playheadFrame()`) and Delete call their handlers. Edit appears for slides, diagrams and HTML scenes only.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - Sections use `Inspector`-local `Row` (key in muted, value in text).
  - Length: `formatTimecode(item.duration / FPS)`.
  - Voice: the segment's `voice` from `segmentsForItem`, or "No voice yet".
  - Look values map through `VARIANT_FOR`.
  - In `Editor`:
    - `onLook` → `sceneClient.update` (slides and diagrams, with `style.theme`), then `drawPendingDiagrams` for a diagram; or `htmlSceneClient.edit(…, { style: { theme } })` for an HTML scene. Then `refreshTimeline()`.
    - `playheadFrame` → `playerRef.current?.getCurrentFrame() ?? 0`.
- [ ] **Step 4: Run**, typecheck → PASS.
- [ ] **Step 5: Commit** — `Add the inspector: the selected clip, or the project when nothing is`.

---

### Task 6: Stage, transport and timeline

**Files:** Modify `TransportBar.tsx`, `Timeline.tsx`, `ClipNarrationBox.tsx`, `ScriptView.tsx` (paper text token), `VoiceLayer` styling in `Timeline.tsx`, `Editor.tsx` (tabs, stage frame).

- [ ] **Step 1: Failing tests** — The transport keeps its accessible names (Play, Previous clip, Next clip, Playback position, Mute, Fullscreen; the existing tests cover these), and the Play button uses the gradient. The timeline tools sit in `role="group" aria-label="Edit the timeline"`; the AI actions stay as buttons named "Write the words" and the voice-all label.
- [ ] **Step 2: Run** → FAIL on the new assertions.
- [ ] **Step 3: Implement.**
  - **Transport:** a floating pill, `mx-auto mb-2 flex w-fit items-center gap-3 rounded-full bg-surface px-2 py-1.5 shadow-lg`. Play is `bg-accent-gradient text-on-gradient rounded-full`; the progress fill is `bg-accent-gradient`.
  - **Stage:** the video frame gets `rounded-xl` and loses `ring-1 ring-border`.
  - **Tabs:** no box. The active tab gets `font-medium text-text` and a 2 px `bg-accent-gradient` underline; the Script tab's paper colouring moves to its underline (`bg-paper-border`).
  - **Timeline toolbar:**
    - "Write the words" and the voice-all button become `variant="soft"` (icons in `text-accent`).
    - Undo, redo, remove-at-playhead, split, zoom out and zoom in go inside `<ButtonGroup aria-label="Edit the timeline">`.
    - The confirm-delete strip uses `bg-danger-bg`.
  - **Clips:** remove `border` from the clip button; base `bg-raised rounded-lg`; selected gets `ring-2 ring-accent`. Kind chips keep their colours.
  - **Waveforms:** voiced bars use `bg-accent-gradient` at 70% opacity. "Other voice" and "no voice" keep their current meaning, with muted colours.
  - **Script surfaces:** narration text uses `text-paper-text` on `bg-paper`, with no `border-paper-border` round the box.
- [ ] **Step 4: Run** `src/renderer`, typecheck → PASS.
- [ ] **Step 5: Commit** — `Restyle the stage, transport and timeline for Studio`.

---

### Task 7: Home

**Files:** Modify `screens/ProjectBrowser.tsx`, `ProjectBrowser.test.tsx`, `App.tsx` (remember the last project opened).

**Interfaces — Produces:** `rememberLastProject(id: string): void` and `lastProjectId(): string | null` in `src/renderer/src/lib/lastProject.ts` (localStorage `talkie.lastProject`, try/catch).

- [ ] **Step 1: Failing tests**
  - The last opened project leads, in a "Continue where you left off" section, with "Open project" (`aria-label="Open <name>"` stays on the poster card).
  - With nothing remembered, the newest leads.
  - The rest are in the grid, without the leading one.
  - Opening remembers the project.
  - With one project there is no separate grid.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - The lead card is a 2-column `grid-cols-[1.3fr_1fr] rounded-2xl bg-surface`: poster, then name, chips (`bg-raised` / success tint for "Voiced"), age and a `soft` "Open project" button.
  - Grid cards: `rounded-xl bg-surface`, no border, `hover:bg-surface-hover`. The duration tag is `bg-black/60 backdrop-blur rounded-md`.
  - "New project" becomes `variant="gradient"`.
  - Create form and empty, loading and error states: same structure, borderless.
  - `App.tsx` calls `rememberLastProject` in `setOpenProject` and `switchProject`.
- [ ] **Step 4: Run**, typecheck → PASS.
- [ ] **Step 5: Commit** — `Restyle the project browser, led by the project you were last in`.

---

### Task 8: Dialogs and the recording toolbar

**Files:** `SettingsDialog.tsx`, `SceneEditor.tsx`, `AboutProjectDialog.tsx`, `themes/CreateThemeDialog.tsx`, `themes/ThemeEditor.tsx`, `themes/ThemesSection.tsx`, `htmlScene/HtmlScenePanel.tsx`, `ExportedCard.tsx`, `ProjectSwitcher.tsx`, `src/renderer/toolbar.html`/`toolbar.ts`.

- [ ] **Step 1:** Overlays: replace `bg-black/45 backdrop-blur-[2px]` with `bg-black/55 backdrop-blur-sm`. Dialog panels: `rounded-2xl bg-surface shadow-2xl` with no `border`. Internal section boxes: `bg-raised rounded-xl` instead of `border border-border`. Primary actions use `gradient` (they already use `Button` default `primary`, which now aliases it).
- [ ] **Step 2: Recording toolbar** (`toolbar.html`, plain CSS on the same tokens):
  - a `#17181e` pill with `border-radius: 999px` and a soft shadow
  - record and stop in `--color-danger`
  - the timer in `--color-text`, the other controls borderless
  - the same `data-theme` handling it has today
- [ ] **Step 3:** `git grep -n "border border-border" src/renderer/src` — for each remaining hit, keep it only where it is a divider inside a panel. Otherwise replace it with a surface step.
- [ ] **Step 4: Run** `src/renderer`, typecheck → PASS.
- [ ] **Step 5: Commit** — `Restyle dialogs and the recording toolbar for Studio`.

---

### Task 9: Visual check, docs, full verification

**Files:** `AGENTS.md` (Conventions: the accent rule), `docs/superpowers/specs/2026-09-09-ui-redesign-design.md` (a superseded note at the top), scratch screenshots (not committed).

- [ ] **Step 1:** `npm run build`. Script Playwright's `_electron.launch({ args: ['out/main/index.cjs'] })` to screenshot, in **dark and light**:
  - home
  - the editor with each rail panel open, and with a clip selected
  - the Script tab
  - Settings → Themes
  - the scene editor (Slide and HTML)
  - About this project

  Look at every one, and fix what looks wrong before going on.
- [ ] **Step 2:** In AGENTS.md, replace the "Design tokens only… The accent is azure (`#1a5fb4` light, `#7ab5f0` dark)…" bullet with: the accent is a violet→cyan gradient for surfaces and a solid violet for text (`#a99fff` dark, `#4b37d0` light); text on the gradient is `#0e0f13`; floors are 5.8:1 for accent text and 4.5:1 for body; `contrast.test.ts` enforces them.
- [ ] **Step 3:** `npm run typecheck && npm test` → all pass.
- [ ] **Step 4: Commit** — `Document the Studio look`.

---

## Self-review

- **Spec coverage:**

  | Spec section | Task |
  |---|---|
  | §1 tokens and contrast | 1 |
  | Shape, depth, focus | 1, 2 |
  | Type | 1 (deviation: Geist kept) |
  | Primitives | 2 |
  | §2 Editor rail and panels | 3, 4 |
  | Inspector | 5 (deviation: no click count) |
  | Stage, timeline, top bar | 3, 6 |
  | Home | 7 |
  | Dialogs and toolbar | 8 |
  | §4 build order | Task order |
  | §5 testing | Each task, 1, 9 |
  | §6 docs | 9 |

- **Risks:**
  - The agent conversation surviving the panel closing (Task 4 lifts its state, with a test).
  - Esc conflicting with dialogs (Task 4 skips Esc while a dialog is open or while typing).
- **Types:** `RailPanelId`, `ExportControl`, `TopBarActions`, `Inspector` props and `ButtonVariant` are defined once and used by name.
