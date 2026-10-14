# UI Redesign Design

> **Superseded in look** by `2026-10-11-studio-redesign-design.md`. The foundations here —
> Tailwind, CSS-variable tokens, the `ui/` primitives, renderer tests — still stand.

## 1. Purpose & Scope

Demo Editor's functionality (Plans 1-4: project management, browser-session recording, image import, preview/export, transcript editing + TTS narration) is complete and working, but the renderer has zero visual design applied — every screen is bare, unstyled HTML elements with no CSS anywhere in the codebase. This makes the app effectively unusable for real testing or demoing, despite the underlying features working correctly.

This design covers a full UI "phase lift": introducing a real design system (Tailwind, light/dark theming, a shared component primitive library) and redesigning both existing screens — the Project Browser and the Editor — including several new interaction patterns in the Editor (resizable/collapsible panels, drag-and-drop timeline reordering, an icon-based toolbar).

Explicitly out of scope: any change to the preview player's internals, the export pipeline's internals, the capture/recording pipeline's internals, or the transcript/TTS pipeline's internals (Plans 2-4). This is a UI chrome and interaction-pattern pass around already-working functionality — one small, well-isolated backend addition (timeline reordering, see §5) is the only exception.

## 2. Goals

- Replace every bare/unstyled element with a real design system: consistent colors, typography, spacing, and component primitives.
- Support both light and dark themes from day one, toggleable and persisted per-device.
- Redesign the Project Browser as a card grid with proper empty/loading/error states.
- Redesign the Editor with an icon-based toolbar, resizable panels, collapsible sidebars, and drag-and-drop timeline clip reordering.
- Introduce renderer-side automated testing (Vitest + React Testing Library) for the first time in this codebase, alongside the existing main-process test suite.
- Preserve all existing functionality exactly as-is — this is a visual and interaction-pattern pass, not a functionality change (except the one reordering addition).

## 3. Non-Goals

- No changes to composition/rendering, the export pipeline, the Playwright capture pipeline, or the transcript/TTS pipeline's business logic.
- No new screens beyond the existing two (Project Browser, Editor).
- No mobile/responsive-web support — this is a fixed-size Electron desktop window.
- No AI-driven UI (agent system) — out of scope for this pass entirely (tracked separately, not started).
- No project-level (per-project, synced-to-disk) UI preferences — theme and panel-size preferences are per-device, stored in `localStorage`.

## 4. Tech Stack

- **Tailwind CSS** (`tailwindcss`, `postcss`, `autoprefixer`) — utility-first styling, configured with a custom design-token scale (colors, spacing, radii, font sizes, shadows) in `tailwind.config.ts`.
- **Theming**: CSS custom properties defined for both `light` and `dark` palettes, switched via a `data-theme` attribute on the document root; Tailwind's `dark:` variant configured to key off that attribute (`darkMode: ['selector', '[data-theme="dark"]']`). Toggle state persisted to `localStorage` under a single key (e.g. `demo-editor-theme`).
- **`lucide-react`** — icon set for the toolbar, panel headers, and buttons.
- **`react-resizable-panels`** — resizable + collapsible panel groups for the Editor's 3-column layout.
- **`@dnd-kit/core` + `@dnd-kit/sortable`** — drag-and-drop reordering for the Editor's footer timeline clip strip.
- **Vitest + `@testing-library/react` + `@testing-library/jest-dom`** — renderer component testing, introduced in this plan. Configured as a separate Vitest project/config (or a shared config with a `jsdom` environment override for `*.test.tsx` files) alongside the existing Node-environment tests for the main process.

## 5. Architecture

### 5.1 Design tokens & theming

A new `src/renderer/src/styles/tokens.css` (or equivalent, loaded once in `main.tsx`) defines CSS custom properties for both themes:

```css
:root[data-theme='light'] { --color-bg: ...; --color-surface: ...; --color-text: ...; --color-text-muted: ...; --color-border: ...; --color-accent: ...; --color-danger: ...; }
:root[data-theme='dark']  { /* same variable names, dark values */ }
```

Tailwind's `theme.extend.colors` maps to these variables (e.g. `bg: 'var(--color-bg)'`) so utility classes like `bg-bg`, `text-text`, `border-border` work in both themes without duplicating class lists. A `useTheme()` hook in `src/renderer/src/hooks/useTheme.ts` reads/writes `localStorage` and sets `document.documentElement.dataset.theme`, defaulting to the OS preference (`prefers-color-scheme`) on first launch.

### 5.2 Shared UI primitives

New directory `src/renderer/src/components/ui/`, one component per file, each with a colocated `*.test.tsx`:

- `Button.tsx` — variants: `primary`, `secondary`, `ghost`, `icon`; sizes: `sm`, `md`.
- `Input.tsx`, `Textarea.tsx` — styled form controls matching the token palette.
- `Card.tsx` — a bordered, padded surface container (used by project cards and transcript segment rows).
- `Panel.tsx` — a titled container with an optional collapse affordance (used inside the Editor's resizable panel group headers).
- `IconButton.tsx` — icon-only button (wraps `Button` variant=`icon`), used throughout the toolbar and panel headers.
- `Toolbar.tsx` — a horizontal flex container for grouping `IconButton`s with dividers.
- `EmptyState.tsx` — icon + message + optional action button, for "no projects yet" and similar states.
- `Spinner.tsx` — a small loading indicator (used during list loading, export-in-progress, narrate-in-progress).
- `ErrorBanner.tsx` — the one shared error-presentation convention (replaces every screen's bare `{error && <div>{error}</div>}` / `<p style={{color:'red'}}>` pattern from Plans 1-4).

`AppShell.tsx` (new, in `src/renderer/src/components/`) wraps both screens with a persistent top bar: app name/logo placeholder + the theme toggle button. `App.tsx` renders `<AppShell>{openProjectId ? <Editor .../> : <ProjectBrowser .../>}</AppShell>`.

### 5.3 Project Browser

`ProjectBrowser.tsx` is restructured (not just restyled) to:
- Track a `loading` state during the initial `projectClient.list()` call, rendering a `Spinner` while true.
- Render `EmptyState` when `projects.length === 0` after loading.
- Render a responsive grid of `Card`-based project tiles otherwise, each showing name + relative created-date (a small `formatRelativeTime(iso: string): string` helper, new pure utility, unit-tested), with a `+ New Project` tile as the grid's first entry that expands an inline create form (`Input` + `Button`) in place.
- Replace the bare error `<div>` with `ErrorBanner`.

### 5.4 Editor

`Editor.tsx` is restructured around `react-resizable-panels`:

```tsx
<PanelGroup direction="horizontal">
  <Panel id="sources" collapsible defaultSize={20} minSize={12}>...</Panel>
  <PanelResizeHandle />
  <Panel id="preview" defaultSize={55} minSize={30}>...</Panel>
  <PanelResizeHandle />
  <Panel id="transcript" collapsible defaultSize={25} minSize={15}>...</Panel>
</PanelGroup>
```

Panel sizes persist via `react-resizable-panels`' built-in `autoSaveId` prop (backed by `localStorage`, no custom code needed).

- The left panel's plain buttons become a `Toolbar` of `IconButton`s (Import, Export, Record), each with a lucide icon; a recording indicator (small pulsing dot + "Recording…" label) renders in the toolbar while a capture session is active; export shows a `Spinner` + "Exporting…" during `exporting`, and the exported-path success message uses a small toast-style inline confirmation instead of a bare `<p>`.
- The footer timeline strip becomes a `@dnd-kit` `SortableContext` of clip tiles; dragging one to a new position calls a new `reorderTimelineItems` (see below) and updates local state.
- `TranscriptPanel.tsx` is restyled in place: each segment becomes a `Card` with the textarea, status badge, and an `IconButton` (lucide `Mic`/spinner) for Narrate; the "Add Segment" section becomes a small form using `Input`/`Textarea`/`Button`; the bare error `<p>` becomes `ErrorBanner`. No logic changes beyond what Phase C's scope adds (a disabled-while-adding guard, matching the existing disabled-while-narrating pattern — closes a Minor gap flagged in Plan 4's final review).

### 5.5 New backend piece: timeline reordering

Dragging a clip in the timeline strip needs a way to persist the new order. New function in `src/main/project/projectApi.ts`:

```ts
function reorderTimelineItems(id: string, orderedIds: string[], baseDir?: string): TimelineItem[]
```

Reads the existing timeline, validates `orderedIds` is a permutation of the existing item ids (throws a clear error otherwise — same strict-validation posture as every other write path in this file), reorders the array to match, then recomputes each item's `start` sequentially (`item[0].start = 0`, `item[i].start = item[i-1].start + item[i-1].duration`) preserving each item's own `duration`, validates each recomputed item through `TimelineItemSchema`, writes atomically via the existing `writeJsonAtomic` pattern, and returns the updated array. Exposed through a new `project:timeline:reorder` IPC channel and `timelineClient.reorder(projectId, orderedIds)`, following the exact patterns established in Plans 1-4.

## 6. Data Flow

No new cross-process data flows beyond `reorderTimelineItems` (renderer → IPC → `projectApi` → `timeline.json`, same shape as every existing timeline mutation). Theme and panel-size state are renderer-local (`localStorage`), never touching the main process or project files — they are device preferences, not project data.

## 7. Error Handling

- Every async action across both screens uses the same convention going forward: a local error string state, rendered via `ErrorBanner`, cleared at the start of the next attempt — this generalizes the pattern Plans 1-4 already used ad hoc (bare `{error}` divs/paragraphs) into one shared component with consistent styling.
- `reorderTimelineItems`'s permutation-validation error (a dropped/duplicated id from a buggy drag event) surfaces through the same `ErrorBanner` convention in the Editor.

## 8. Testing Strategy

- **New renderer component tests** (Vitest + React Testing Library, `jsdom` environment) for every new `components/ui/` primitive (render + interaction, e.g. `Button` calls `onClick`, `Panel` toggles collapse) and for the restructured `ProjectBrowser` (loading → empty state → populated grid → create flow) and `TranscriptPanel` (unchanged logic, but the disabled-while-adding guard is new and gets a test).
- **New main-process test** for `reorderTimelineItems` (TDD, following the exact existing `projectApi.test.ts` conventions: valid reorder recomputes `start` values correctly and preserves durations; invalid permutation throws a clear, flattened error).
- Drag-and-drop and resizable-panel interactions themselves are not unit-tested (both libraries are already well-tested upstream) — verified manually by running the app (via the `run`/`webapp-testing` skill) once each phase lands.
- Existing main-process suite (85 tests as of Plan 4) must continue to pass unchanged throughout.

## 9. Phasing

Implemented as three separate plans, each independently reviewed and merged before the next starts:

- **Phase A — Design System Foundation**: Tailwind setup, theme tokens + toggle + `useTheme` hook, all `components/ui/` primitives with tests, `AppShell`. No existing screen behavior changes.
- **Phase B — Project Browser Redesign**: card grid, empty/loading states, inline create form, `ErrorBanner` adoption.
- **Phase C — Editor Redesign**: resizable/collapsible panel layout, icon toolbar with recording/export status, drag-and-drop timeline reordering (+ the `reorderTimelineItems` backend piece), restyled `TranscriptPanel`.

## 10. Open Questions

None outstanding — all major decisions (styling stack, theming approach, icon set, panel/DnD libraries, phasing, testing strategy) were resolved during brainstorming.
