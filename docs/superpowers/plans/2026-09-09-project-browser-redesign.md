# Project Browser Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Project Browser's bare, unstyled `<ul>`/`<input>`/`<button>` layout with a real card-grid UI — loading spinner, empty state, a responsive grid of project cards showing name + relative creation time, and an inline "+ New Project" create form — using the `components/ui/` primitive library and theme tokens Phase A already built. No change to the underlying `projectClient` calls or data flow.

**Architecture:** `ProjectBrowser.tsx` is restructured (not just restyled) around three mutually-exclusive render states — loading, empty, and grid — driven by existing `projectClient.list()`/`.create()` calls. A new pure utility, `formatRelativeTime`, turns each project's ISO `createdAt` into a human string ("5 minutes ago", falling back to a formatted date past 30 days). The "+ New Project" grid tile toggles in place into an inline `Input` + `Button` form; the rest of the grid is `Card`-wrapped native `<button>`s for keyboard/screen-reader-accessible click targets.

**Tech Stack:** No new dependencies — reuses Phase A's `components/ui/` primitives (`Card`, `Button`, `Input`, `EmptyState`, `Spinner`, `ErrorBanner`), `lucide-react` (already installed), and the existing Vitest + React Testing Library renderer test setup.

**Spec:** `docs/superpowers/specs/2026-09-09-ui-redesign-design.md` (this plan implements §5.3 — Phase B of §9)

## Global Constraints

- Use only the semantic Tailwind color classes Phase A defined (`bg`, `surface`, `surface-hover`, `border`, `text`, `text-muted`, `accent`, `accent-hover`, `danger`, `danger-bg`) — never raw palette classes (e.g. `bg-gray-100`). This is what makes the grid/cards/form re-theme automatically with the existing light/dark toggle.
- Preserve `ProjectBrowser`'s external prop signature exactly: `ProjectBrowser({ onOpen }: { onOpen: (id: string) => void }): JSX.Element`. `App.tsx` already renders `<ProjectBrowser onOpen={setOpenProjectId} />` and must not need any change.
- Preserve existing behavior: `projectClient.list()` is still called once on mount, `projectClient.create(name)` is still called with the trimmed name, and a successful create still calls `onOpen(created.id)` immediately (no change to the create-then-navigate flow).
- Every new file gets a colocated `*.test.ts`/`*.test.tsx`, following the existing convention (see any `src/renderer/src/components/ui/*.test.tsx`).
- No comments explaining what code does — only where a non-obvious constraint needs flagging.
- This plan develops directly on `main` (explicit user instruction — no worktree for this phase) — commit directly as work progresses.
- Out of scope (per spec §3/§9): the Editor screen, `TranscriptPanel`, `react-resizable-panels`, `@dnd-kit`, and the `reorderTimelineItems` backend piece are all Phase C, not this plan.

---

## File Structure

```
src/renderer/src/
  lib/
    formatRelativeTime.ts          # new — turns an ISO date string into "5 minutes ago" / "Jul 26, 2026"
    formatRelativeTime.test.ts     # new
  screens/
    ProjectBrowser.tsx             # modified — full restructure: loading / empty / grid states
    ProjectBrowser.test.tsx        # new
```

---

### Task 1: `formatRelativeTime` utility

**Files:**
- Create: `src/renderer/src/lib/formatRelativeTime.ts`
- Test: `src/renderer/src/lib/formatRelativeTime.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no dependencies on other tasks)
- Produces: `formatRelativeTime(iso: string): string` — used by Task 2

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRelativeTime } from './formatRelativeTime'

const NOW = new Date('2026-09-09T12:00:00.000Z')

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "just now" for timestamps under a minute old', () => {
    const iso = new Date(NOW.getTime() - 30 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('just now')
  })

  it('returns singular "1 minute ago"', () => {
    const iso = new Date(NOW.getTime() - 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('1 minute ago')
  })

  it('returns plural minutes', () => {
    const iso = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('5 minutes ago')
  })

  it('returns singular "1 hour ago"', () => {
    const iso = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('1 hour ago')
  })

  it('returns plural hours', () => {
    const iso = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('3 hours ago')
  })

  it('returns singular "1 day ago"', () => {
    const iso = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('1 day ago')
  })

  it('returns plural days', () => {
    const iso = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('2 days ago')
  })

  it('falls back to a formatted date past 30 days', () => {
    const iso = new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('Jul 26, 2026')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/renderer/src/lib/formatRelativeTime.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const THIRTY_DAYS = 30 * DAY

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then

  if (diff < MINUTE) return 'just now'

  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }

  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }

  if (diff < THIRTY_DAYS) {
    const days = Math.floor(diff / DAY)
    return `${days} day${days === 1 ? '' : 's'} ago`
  }

  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/renderer/src/lib/formatRelativeTime.test.ts
```

Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/formatRelativeTime.ts src/renderer/src/lib/formatRelativeTime.test.ts
git commit -m "Add formatRelativeTime utility"
```

---

### Task 2: Restructure `ProjectBrowser` around loading / empty / grid states

**Files:**
- Modify: `src/renderer/src/screens/ProjectBrowser.tsx`
- Test: `src/renderer/src/screens/ProjectBrowser.test.tsx`

**Interfaces:**
- Consumes: `formatRelativeTime` (Task 1); `Card` from `../components/ui/Card`, `Button` from `../components/ui/Button`, `Input` from `../components/ui/Input`, `EmptyState` from `../components/ui/EmptyState`, `Spinner` from `../components/ui/Spinner`, `ErrorBanner` from `../components/ui/ErrorBanner` (all Phase A); `projectClient`, `ProjectSummary` from `../api/projectClient` (unchanged)
- Produces: `ProjectBrowser({ onOpen }: { onOpen: (id: string) => void }): JSX.Element` — unchanged external signature, consumed by `App.tsx` (no change needed there)

- [ ] **Step 1: Write the failing tests**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectBrowser } from './ProjectBrowser'
import { projectClient } from '../api/projectClient'

vi.mock('../api/projectClient', () => ({
  projectClient: {
    list: vi.fn(),
    create: vi.fn()
  }
}))

const mockedList = vi.mocked(projectClient.list)
const mockedCreate = vi.mocked(projectClient.create)

describe('ProjectBrowser', () => {
  beforeEach(() => {
    mockedList.mockReset()
    mockedCreate.mockReset()
  })

  it('shows a spinner while loading', () => {
    mockedList.mockReturnValue(new Promise(() => {}))
    render(<ProjectBrowser onOpen={vi.fn()} />)
    expect(screen.getByRole('status', { name: 'Loading projects' })).toBeInTheDocument()
  })

  it('shows an empty state when there are no projects', async () => {
    mockedList.mockResolvedValue([])
    render(<ProjectBrowser onOpen={vi.fn()} />)
    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
  })

  it('shows a grid of project cards with relative creation time', async () => {
    mockedList.mockResolvedValue([{ id: 'p1', name: 'My Project', createdAt: new Date().toISOString() }])
    render(<ProjectBrowser onOpen={vi.fn()} />)
    expect(await screen.findByRole('button', { name: /My Project/ })).toBeInTheDocument()
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('opens a project when its card is clicked', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    mockedList.mockResolvedValue([{ id: 'p1', name: 'My Project', createdAt: new Date().toISOString() }])
    render(<ProjectBrowser onOpen={onOpen} />)
    await user.click(await screen.findByRole('button', { name: /My Project/ }))
    expect(onOpen).toHaveBeenCalledWith('p1')
  })

  it('shows an error banner when loading fails', async () => {
    mockedList.mockRejectedValue(new Error('disk on fire'))
    render(<ProjectBrowser onOpen={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('disk on fire')
  })

  it('expands an inline create form when New Project is clicked, then creates a project', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    mockedList.mockResolvedValue([])
    mockedCreate.mockResolvedValue({ id: 'p2', name: 'Fresh', createdAt: new Date().toISOString(), schemaVersion: 1 })
    render(<ProjectBrowser onOpen={onOpen} />)

    await user.click(await screen.findByRole('button', { name: 'New Project' }))
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Fresh')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('p2'))
    expect(mockedCreate).toHaveBeenCalledWith('Fresh')
  })

  it('disables Create while the name is blank', async () => {
    const user = userEvent.setup()
    mockedList.mockResolvedValue([])
    render(<ProjectBrowser onOpen={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'New Project' }))
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('collapses the create form when Cancel is clicked', async () => {
    const user = userEvent.setup()
    mockedList.mockResolvedValue([])
    render(<ProjectBrowser onOpen={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'New Project' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'New Project' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/renderer/src/screens/ProjectBrowser.test.tsx
```

Expected: FAIL — current implementation has no `role="status"` spinner, no empty state text, no card grid, no accessible "New Project" button.

- [ ] **Step 3: Write the implementation**

```tsx
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { projectClient, type ProjectSummary } from '../api/projectClient'
import { formatRelativeTime } from '../lib/formatRelativeTime'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { EmptyState } from '../components/ui/EmptyState'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'

export function ProjectBrowser({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    projectClient
      .list()
      .then(setProjects)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  async function handleCreate(): Promise<void> {
    if (!newName.trim()) return
    setError(null)
    setCreating(true)
    try {
      const created = await projectClient.create(newName.trim())
      setNewName('')
      setShowCreateForm(false)
      onOpen(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  function handleCancelCreate(): void {
    setShowCreateForm(false)
    setNewName('')
  }

  function renderContent(): JSX.Element {
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size="md" label="Loading projects" />
        </div>
      )
    }

    if (projects.length === 0 && !showCreateForm) {
      return (
        <EmptyState
          title="No projects yet"
          description="Create your first project to get started."
          action={<Button onClick={() => setShowCreateForm(true)}>New Project</Button>}
        />
      )
    }

    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
        {showCreateForm ? (
          <Card className="flex flex-col gap-2">
            <Input
              autoFocus
              aria-label="Project name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              disabled={creating}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancelCreate} disabled={creating}>
                Cancel
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="border-dashed p-0">
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg p-4 text-text-muted hover:bg-surface-hover hover:text-text"
            >
              <Plus size={20} aria-hidden="true" />
              <span className="text-sm font-medium">New Project</span>
            </button>
          </Card>
        )}
        {projects.map((project) => (
          <Card key={project.id} className="p-0">
            <button
              type="button"
              onClick={() => onOpen(project.id)}
              className="flex w-full flex-col gap-1 rounded-lg p-4 text-left hover:bg-surface-hover"
            >
              <span className="text-sm font-medium text-text">{project.name}</span>
              <span className="text-xs text-text-muted">{formatRelativeTime(project.createdAt)}</span>
            </button>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold text-text">Demo Editor</h1>
      {error && <ErrorBanner message={error} />}
      {renderContent()}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/renderer/src/screens/ProjectBrowser.test.tsx
```

Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/screens/ProjectBrowser.tsx src/renderer/src/screens/ProjectBrowser.test.tsx
git commit -m "Redesign Project Browser as a card grid with inline create form"
```

---

### Task 3: Full plan verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

```bash
npm run test
```

Expected: PASS — all existing tests plus the new `formatRelativeTime.test.ts` and `ProjectBrowser.test.tsx` suites from this plan.

- [ ] **Step 2: Run the full typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Manually verify in the running app**

```bash
npm run dev
```

In the running window: confirm the Project Browser now shows a loading spinner briefly, then either an empty state (fresh install) or a grid of project cards each showing name + relative time (e.g. "3 minutes ago"). Click the "+ New Project" tile (or the empty state's button), type a name, click Create, and confirm it navigates into the Editor for the new project. Click Cancel on an open create form and confirm it collapses back to the tile without creating anything. Toggle the theme (top-right, from Phase A) and confirm the grid, cards, and form re-color correctly in both light and dark.

- [ ] **Step 4: Clean up**

Stop the dev server (Ctrl+C).

- [ ] **Step 5: Final commit** (only if any of the above required fixes)

```bash
git add -A
git commit -m "Fix issues found in Project Browser redesign verification"
```

If nothing needed fixing, there is nothing to commit — this plan is complete.
