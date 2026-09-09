# UI Design System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Demo Editor's renderer a real design system — Tailwind CSS with light/dark theming and a library of shared, tested UI primitives — replacing the completely unstyled bare-HTML screens that exist today, with zero behavior change to the existing screens beyond wrapping them in a persistent app shell.

**Architecture:** Tailwind CSS provides utility classes mapped to CSS custom-property design tokens, so a single `data-theme` attribute switch (persisted via a `useTheme` hook) re-themes the whole app without any per-component dark-mode logic. A new `components/ui/` directory holds small, independently-tested primitive components (Button, Input, Card, Panel, etc.) that later phases (Project Browser and Editor redesigns) will compose. This plan also introduces renderer-side component testing (Vitest + React Testing Library) for the first time in this codebase.

**Tech Stack:** Tailwind CSS 3.4, PostCSS, autoprefixer, `clsx` + `tailwind-merge` (className composition), `lucide-react` (icons), Vitest + `@testing-library/react` + `@testing-library/jest-dom` + `@testing-library/user-event` (renderer tests, jsdom environment).

**Spec:** `docs/superpowers/specs/2026-09-09-ui-redesign-design.md` (this plan implements §5.1 and §5.2 — Phase A of §9)

## Global Constraints

- Design tokens are CSS custom properties, mapped into Tailwind as semantic color names: `bg`, `surface`, `surface-hover`, `border`, `text`, `text-muted`, `accent`, `accent-hover`, `danger`, `danger-bg`. Every new component uses these semantic classes (e.g. `bg-surface`, `text-text-muted`) — never Tailwind's raw palette classes (e.g. `bg-gray-900`) — so theme switching works everywhere automatically with no per-component dark-mode code.
- Theme switching is done via a `data-theme="light"|"dark"` attribute on `document.documentElement`, with Tailwind's `darkMode` configured as `['selector', '[data-theme="dark"]']`. Theme preference persists to `localStorage` under the key `demo-editor-theme` and defaults to the OS's `prefers-color-scheme` when nothing is stored yet.
- Icon-only interactive elements (e.g. `IconButton`) must always receive an explicit `aria-label` — there is no visible text for a screen reader to fall back to.
- Every new file in this plan gets a colocated `*.test.ts`/`*.test.tsx`, except pure build-tooling config files (Tailwind/PostCSS config), which are verified by a successful build instead.
- No comments explaining what code does — only where a non-obvious constraint needs flagging.
- No behavior changes to `src/renderer/src/screens/ProjectBrowser.tsx` or `src/renderer/src/screens/Editor.tsx` in this plan, beyond both being rendered inside the new `AppShell` — their visual redesigns are separate, future plans (Phase B and Phase C).
- This plan develops in the current worktree (already at the same commit as `main`) — commit directly to this branch as work progresses, no additional worktree needed.

---

## File Structure

```
tailwind.config.ts                                    # new
postcss.config.js                                      # new
vitest.config.ts                                        # modified — jsdom for renderer tests
tsconfig.web.json                                        # modified — jest-dom matcher types
package.json                                             # modified — new deps

src/renderer/src/
  styles/
    index.css                                            # new — @tailwind directives + theme tokens
  main.tsx                                                # modified — imports index.css
  App.tsx                                                 # modified — wraps screens in AppShell
  test/
    setup.ts                                              # new — jest-dom matchers + RTL cleanup
  hooks/
    useTheme.ts                                           # new
    useTheme.test.tsx                                     # new
  lib/
    cn.ts                                                 # new
    cn.test.ts                                            # new
  components/
    AppShell.tsx                                          # new
    AppShell.test.tsx                                     # new
    ui/
      Button.tsx / Button.test.tsx                        # new
      Input.tsx / Input.test.tsx                          # new
      Textarea.tsx / Textarea.test.tsx                    # new
      IconButton.tsx / IconButton.test.tsx                # new
      Spinner.tsx / Spinner.test.tsx                      # new
      Card.tsx / Card.test.tsx                            # new
      Panel.tsx / Panel.test.tsx                          # new
      Toolbar.tsx / Toolbar.test.tsx                      # new
      EmptyState.tsx / EmptyState.test.tsx                # new
      ErrorBanner.tsx / ErrorBanner.test.tsx               # new
```

---

### Task 1: Tailwind CSS & PostCSS setup

**Files:**
- Modify: `package.json`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `src/renderer/src/styles/index.css`
- Modify: `src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: Tailwind utility classes and the semantic color tokens (`bg`, `surface`, `surface-hover`, `border`, `text`, `text-muted`, `accent`, `accent-hover`, `danger`, `danger-bg`) available to every component from Task 3 onward. No test file — this is pure build tooling, verified by a successful build.

- [ ] **Step 1: Install dependencies**

```bash
npm install -D tailwindcss@^3.4.13 postcss@^8.4.47 autoprefixer@^10.4.20
npm install clsx@^2.1.1 tailwind-merge@^2.5.2 lucide-react@^0.445.0
```

- [ ] **Step 2: Create `tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss'

export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-hover': 'var(--color-surface-hover)',
        border: 'var(--color-border)',
        text: 'var(--color-text)',
        'text-muted': 'var(--color-text-muted)',
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        danger: 'var(--color-danger)',
        'danger-bg': 'var(--color-danger-bg)'
      }
    }
  },
  plugins: []
} satisfies Config
```

- [ ] **Step 3: Create `postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
}
```

- [ ] **Step 4: Create `src/renderer/src/styles/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-bg: #ffffff;
  --color-surface: #f8f9fb;
  --color-surface-hover: #eef0f3;
  --color-border: #e2e4e9;
  --color-text: #14151a;
  --color-text-muted: #6b7280;
  --color-accent: #4f46e5;
  --color-accent-hover: #4338ca;
  --color-danger: #dc2626;
  --color-danger-bg: #fef2f2;
}

:root[data-theme='dark'] {
  --color-bg: #0f1115;
  --color-surface: #181b21;
  --color-surface-hover: #21252c;
  --color-border: #2a2e37;
  --color-text: #f2f3f5;
  --color-text-muted: #9aa0ac;
  --color-accent: #6366f1;
  --color-accent-hover: #818cf8;
  --color-danger: #f87171;
  --color-danger-bg: #451a1a;
}

html {
  color-scheme: light dark;
}

body {
  background-color: var(--color-bg);
  color: var(--color-text);
}
```

- [ ] **Step 5: Import the stylesheet in `src/renderer/src/main.tsx`**

Add as the first import in the file:

```ts
import './styles/index.css'
```

- [ ] **Step 6: Verify the build processes Tailwind**

```bash
npm run build
ls out/renderer/assets/*.css
grep -q "box-sizing" out/renderer/assets/*.css && echo "Tailwind preflight present"
```

Expected: `npm run build` exits 0, a `.css` file exists under `out/renderer/assets/`, and the grep confirms Tailwind's base reset (Preflight) was compiled in.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tailwind.config.ts postcss.config.js src/renderer/src/styles/index.css src/renderer/src/main.tsx
git commit -m "Add Tailwind CSS with light/dark design tokens"
```

---

### Task 2: Renderer test infrastructure + useTheme hook

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Modify: `tsconfig.web.json`
- Create: `src/renderer/src/test/setup.ts`
- Create: `src/renderer/src/hooks/useTheme.ts`
- Test: `src/renderer/src/hooks/useTheme.test.tsx`

**Interfaces:**
- Consumes: nothing (Tailwind's `data-theme` selector convention from Task 1)
- Produces: `type Theme = 'light' | 'dark'`, `useTheme(): { theme: Theme; toggleTheme: () => void }` — used by Task 11 (`AppShell`). Also produces the renderer test environment (jsdom + React Testing Library) every subsequent task's `*.test.tsx` files depend on.

- [ ] **Step 1: Write the failing test**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTheme } from './useTheme'

function mockMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })) as unknown as typeof window.matchMedia
}

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('defaults to light when the OS prefers light and nothing is stored', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('defaults to dark when the OS prefers dark and nothing is stored', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('reads a previously stored theme over the OS preference', () => {
    localStorage.setItem('demo-editor-theme', 'dark')
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
  })

  it('toggleTheme flips the theme and persists it', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('dark')
    expect(localStorage.getItem('demo-editor-theme')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/renderer/src/hooks/useTheme.test.tsx
```

Expected: FAIL — `@testing-library/react` cannot be resolved (not yet installed) and/or `./useTheme` module not found.

- [ ] **Step 3: Install test dependencies**

```bash
npm install -D jsdom@^25.0.1 @testing-library/react@^16.0.1 @testing-library/jest-dom@^6.5.0 @testing-library/user-event@^14.5.2
```

- [ ] **Step 4: Update `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts', 'src/remotion/**/*.test.ts', 'src/renderer/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['src/renderer/**/*.test.{ts,tsx}', 'jsdom']],
    setupFiles: ['src/renderer/src/test/setup.ts']
  }
})
```

- [ ] **Step 5: Create `src/renderer/src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
```

- [ ] **Step 6: Add jest-dom matcher types to `tsconfig.web.json`**

Change the `"types"` array from `["vite/client"]` to:

```json
"types": ["vite/client", "@testing-library/jest-dom"]
```

- [ ] **Step 7: Create `src/renderer/src/hooks/useTheme.ts`**

```ts
import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'demo-editor-theme'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  function toggleTheme(): void {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }

  return { theme, toggleTheme }
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
npx vitest run src/renderer/src/hooks/useTheme.test.tsx
```

Expected: PASS (4 tests)

- [ ] **Step 9: Run full typecheck**

```bash
npm run typecheck
```

Expected: exits 0. If the `@testing-library/jest-dom` types entry causes an error, replace it with a triple-slash reference instead: add `/// <reference types="@testing-library/jest-dom" />` at the top of `src/renderer/src/test/setup.ts` and revert `tsconfig.web.json`'s `types` array to `["vite/client"]`.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tsconfig.web.json src/renderer/src/test/setup.ts src/renderer/src/hooks/useTheme.ts src/renderer/src/hooks/useTheme.test.tsx
git commit -m "Add renderer test infrastructure and useTheme hook"
```

---

### Task 3: cn utility + Button primitive

**Files:**
- Create: `src/renderer/src/lib/cn.ts`
- Test: `src/renderer/src/lib/cn.test.ts`
- Create: `src/renderer/src/components/ui/Button.tsx`
- Test: `src/renderer/src/components/ui/Button.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `cn(...inputs: ClassValue[]): string` — used by every subsequent `ui/` component. `Button({ variant, size, className, ...props }): JSX.Element`, `type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon'`, `type ButtonSize = 'sm' | 'md'` — used by Task 5 (`IconButton`).

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/lib/cn.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('joins plain class strings', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('drops falsy values', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c')
  })

  it('resolves conflicting tailwind utility classes, keeping the last one', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})
```

`src/renderer/src/components/ui/Button.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

describe('Button', () => {
  it('renders its children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click me</Button>)
    await user.click(screen.getByRole('button', { name: 'Click me' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not call onClick when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        Click me
      </Button>
    )
    await user.click(screen.getByRole('button', { name: 'Click me' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('merges a custom className with the variant classes', () => {
    render(<Button className="custom-class">Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toHaveClass('custom-class')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/renderer/src/lib/cn.test.ts src/renderer/src/components/ui/Button.test.tsx
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`src/renderer/src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

`src/renderer/src/components/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon'
export type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'bg-surface text-text border border-border hover:bg-surface-hover',
  ghost: 'bg-transparent text-text hover:bg-surface-hover',
  icon: 'bg-transparent text-text-muted hover:bg-surface-hover hover:text-text'
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2 text-sm',
  md: 'h-9 px-3 text-sm'
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps): JSX.Element {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    />
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/renderer/src/lib/cn.test.ts src/renderer/src/components/ui/Button.test.tsx
```

Expected: PASS (3 + 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/cn.ts src/renderer/src/lib/cn.test.ts src/renderer/src/components/ui/Button.tsx src/renderer/src/components/ui/Button.test.tsx
git commit -m "Add cn utility and Button primitive"
```

---

### Task 4: Input + Textarea primitives

**Files:**
- Create: `src/renderer/src/components/ui/Input.tsx`
- Test: `src/renderer/src/components/ui/Input.test.tsx`
- Create: `src/renderer/src/components/ui/Textarea.tsx`
- Test: `src/renderer/src/components/ui/Textarea.test.tsx`

**Interfaces:**
- Consumes: `cn` from `../../lib/cn` (Task 3)
- Produces: `Input(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element`, `Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element` — used by Phase B/C (not this plan)

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/components/ui/Input.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from './Input'

describe('Input', () => {
  it('renders with a placeholder', () => {
    render(<Input placeholder="Project name" />)
    expect(screen.getByPlaceholderText('Project name')).toBeInTheDocument()
  })

  it('calls onChange as the user types', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input placeholder="Project name" onChange={onChange} />)
    await user.type(screen.getByPlaceholderText('Project name'), 'a')
    expect(onChange).toHaveBeenCalled()
  })
})
```

`src/renderer/src/components/ui/Textarea.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Textarea } from './Textarea'

describe('Textarea', () => {
  it('renders with a placeholder', () => {
    render(<Textarea placeholder="Narration text" />)
    expect(screen.getByPlaceholderText('Narration text')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/renderer/src/components/ui/Input.test.tsx src/renderer/src/components/ui/Textarea.test.tsx
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`src/renderer/src/components/ui/Input.tsx`:

```tsx
import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type InputProps = InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...props }: InputProps): JSX.Element {
  return (
    <input
      className={cn(
        'h-9 rounded-md border border-border bg-bg px-3 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
```

`src/renderer/src/components/ui/Textarea.tsx`:

```tsx
import type { TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ className, ...props }: TextareaProps): JSX.Element {
  return (
    <textarea
      className={cn(
        'rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/renderer/src/components/ui/Input.test.tsx src/renderer/src/components/ui/Textarea.test.tsx
```

Expected: PASS (2 + 1 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ui/Input.tsx src/renderer/src/components/ui/Input.test.tsx src/renderer/src/components/ui/Textarea.tsx src/renderer/src/components/ui/Textarea.test.tsx
git commit -m "Add Input and Textarea primitives"
```

---

### Task 5: IconButton + Spinner primitives

**Files:**
- Create: `src/renderer/src/components/ui/IconButton.tsx`
- Test: `src/renderer/src/components/ui/IconButton.test.tsx`
- Create: `src/renderer/src/components/ui/Spinner.tsx`
- Test: `src/renderer/src/components/ui/Spinner.test.tsx`

**Interfaces:**
- Consumes: `Button` from `./Button` (Task 3), `cn` from `../../lib/cn` (Task 3)
- Produces: `IconButton({ 'aria-label': string, children, ...props }): JSX.Element` — used by Task 7 (`Panel`) and Task 11 (`AppShell`). `Spinner({ size?, label?, className? }): JSX.Element` — used by Phase B/C (not this plan)

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/components/ui/IconButton.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IconButton } from './IconButton'

describe('IconButton', () => {
  it('exposes its aria-label as the accessible name', () => {
    render(<IconButton aria-label="Close">×</IconButton>)
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <IconButton aria-label="Close" onClick={onClick}>
        ×
      </IconButton>
    )
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
```

`src/renderer/src/components/ui/Spinner.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Spinner } from './Spinner'

describe('Spinner', () => {
  it('exposes a status role with the default label', () => {
    render(<Spinner />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('exposes a custom label', () => {
    render(<Spinner label="Exporting…" />)
    expect(screen.getByRole('status', { name: 'Exporting…' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/renderer/src/components/ui/IconButton.test.tsx src/renderer/src/components/ui/Spinner.test.tsx
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`src/renderer/src/components/ui/IconButton.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Button } from './Button'
import { cn } from '../../lib/cn'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string
  children: ReactNode
}

export function IconButton({ className, children, ...props }: IconButtonProps): JSX.Element {
  return (
    <Button variant="icon" size="sm" className={cn('h-8 w-8 p-0', className)} {...props}>
      {children}
    </Button>
  )
}
```

`src/renderer/src/components/ui/Spinner.tsx`:

```tsx
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn'

interface SpinnerProps {
  size?: 'sm' | 'md'
  label?: string
  className?: string
}

const SIZE_PX: Record<'sm' | 'md', number> = { sm: 14, md: 20 }

export function Spinner({ size = 'md', label = 'Loading', className }: SpinnerProps): JSX.Element {
  return (
    <span role="status" aria-label={label} className={cn('inline-flex items-center text-text-muted', className)}>
      <Loader2 size={SIZE_PX[size]} className="animate-spin" aria-hidden="true" />
    </span>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/renderer/src/components/ui/IconButton.test.tsx src/renderer/src/components/ui/Spinner.test.tsx
```

Expected: PASS (2 + 2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ui/IconButton.tsx src/renderer/src/components/ui/IconButton.test.tsx src/renderer/src/components/ui/Spinner.tsx src/renderer/src/components/ui/Spinner.test.tsx
git commit -m "Add IconButton and Spinner primitives"
```

---

### Task 6: Card primitive

**Files:**
- Create: `src/renderer/src/components/ui/Card.tsx`
- Test: `src/renderer/src/components/ui/Card.test.tsx`

**Interfaces:**
- Consumes: `cn` from `../../lib/cn` (Task 3)
- Produces: `Card(props: HTMLAttributes<HTMLDivElement>): JSX.Element` — used by Phase B/C (not this plan)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from './Card'

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>content</Card>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('merges a custom className', () => {
    render(<Card data-testid="card" className="custom-class" />)
    expect(screen.getByTestId('card')).toHaveClass('custom-class')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/renderer/src/components/ui/Card.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type CardProps = HTMLAttributes<HTMLDivElement>

export function Card({ className, ...props }: CardProps): JSX.Element {
  return <div className={cn('rounded-lg border border-border bg-surface p-4', className)} {...props} />
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/renderer/src/components/ui/Card.test.tsx
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ui/Card.tsx src/renderer/src/components/ui/Card.test.tsx
git commit -m "Add Card primitive"
```

---

### Task 7: Panel primitive

**Files:**
- Create: `src/renderer/src/components/ui/Panel.tsx`
- Test: `src/renderer/src/components/ui/Panel.test.tsx`

**Interfaces:**
- Consumes: `IconButton` from `./IconButton` (Task 5), `cn` from `../../lib/cn` (Task 3)
- Produces: `Panel({ title, children, collapsible?, defaultCollapsed?, className? }): JSX.Element` — used by Phase C (not this plan)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Panel } from './Panel'

describe('Panel', () => {
  it('renders title and children', () => {
    render(<Panel title="Sources">child content</Panel>)
    expect(screen.getByText('Sources')).toBeInTheDocument()
    expect(screen.getByText('child content')).toBeInTheDocument()
  })

  it('does not render a collapse toggle when not collapsible', () => {
    render(<Panel title="Sources">child content</Panel>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('collapses and expands when the toggle is clicked', async () => {
    const user = userEvent.setup()
    render(
      <Panel title="Sources" collapsible>
        child content
      </Panel>
    )
    expect(screen.getByText('child content')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Collapse Sources' }))
    expect(screen.queryByText('child content')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand Sources' }))
    expect(screen.getByText('child content')).toBeInTheDocument()
  })

  it('starts collapsed when defaultCollapsed is true', () => {
    render(
      <Panel title="Sources" collapsible defaultCollapsed>
        child content
      </Panel>
    )
    expect(screen.queryByText('child content')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/renderer/src/components/ui/Panel.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/cn'
import { IconButton } from './IconButton'

interface PanelProps {
  title: string
  children: ReactNode
  collapsible?: boolean
  defaultCollapsed?: boolean
  className?: string
}

export function Panel({
  title,
  children,
  collapsible = false,
  defaultCollapsed = false,
  className
}: PanelProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <div className={cn('flex flex-col rounded-md border border-border bg-surface', className)}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium text-text">{title}</span>
        {collapsible && (
          <IconButton
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            onClick={() => setCollapsed((prev) => !prev)}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </IconButton>
        )}
      </div>
      {!collapsed && <div className="flex-1 overflow-auto p-3">{children}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/renderer/src/components/ui/Panel.test.tsx
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ui/Panel.tsx src/renderer/src/components/ui/Panel.test.tsx
git commit -m "Add Panel primitive"
```

---

### Task 8: Toolbar primitive

**Files:**
- Create: `src/renderer/src/components/ui/Toolbar.tsx`
- Test: `src/renderer/src/components/ui/Toolbar.test.tsx`

**Interfaces:**
- Consumes: `cn` from `../../lib/cn` (Task 3)
- Produces: `Toolbar(props: HTMLAttributes<HTMLDivElement>): JSX.Element` — used by Phase C (not this plan)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Toolbar } from './Toolbar'

describe('Toolbar', () => {
  it('exposes a toolbar role', () => {
    render(<Toolbar>content</Toolbar>)
    expect(screen.getByRole('toolbar')).toBeInTheDocument()
  })

  it('renders its children', () => {
    render(<Toolbar>content</Toolbar>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/renderer/src/components/ui/Toolbar.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type ToolbarProps = HTMLAttributes<HTMLDivElement>

export function Toolbar({ className, ...props }: ToolbarProps): JSX.Element {
  return (
    <div role="toolbar" className={cn('flex items-center gap-1 border-b border-border bg-surface p-2', className)} {...props} />
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/renderer/src/components/ui/Toolbar.test.tsx
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ui/Toolbar.tsx src/renderer/src/components/ui/Toolbar.test.tsx
git commit -m "Add Toolbar primitive"
```

---

### Task 9: EmptyState primitive

**Files:**
- Create: `src/renderer/src/components/ui/EmptyState.tsx`
- Test: `src/renderer/src/components/ui/EmptyState.test.tsx`

**Interfaces:**
- Consumes: `cn` from `../../lib/cn` (Task 3)
- Produces: `EmptyState({ icon?, title, description?, action?, className? }): JSX.Element` — used by Phase B (not this plan)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No projects yet" />)
    expect(screen.getByText('No projects yet')).toBeInTheDocument()
  })

  it('renders the description when provided', () => {
    render(<EmptyState title="No projects yet" description="Create your first one to get started." />)
    expect(screen.getByText('Create your first one to get started.')).toBeInTheDocument()
  })

  it('does not render a description when omitted', () => {
    render(<EmptyState title="No projects yet" />)
    expect(screen.queryByText(/get started/)).not.toBeInTheDocument()
  })

  it('renders the action when provided', () => {
    render(<EmptyState title="No projects yet" action={<button>New Project</button>} />)
    expect(screen.getByRole('button', { name: 'New Project' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/renderer/src/components/ui/EmptyState.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps): JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 p-8 text-center', className)}>
      {icon && <div className="text-text-muted">{icon}</div>}
      <p className="text-sm font-medium text-text">{title}</p>
      {description && <p className="text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/renderer/src/components/ui/EmptyState.test.tsx
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ui/EmptyState.tsx src/renderer/src/components/ui/EmptyState.test.tsx
git commit -m "Add EmptyState primitive"
```

---

### Task 10: ErrorBanner primitive

**Files:**
- Create: `src/renderer/src/components/ui/ErrorBanner.tsx`
- Test: `src/renderer/src/components/ui/ErrorBanner.test.tsx`

**Interfaces:**
- Consumes: `cn` from `../../lib/cn` (Task 3)
- Produces: `ErrorBanner({ message, className? }): JSX.Element` — used by Phase B/C (not this plan)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBanner } from './ErrorBanner'

describe('ErrorBanner', () => {
  it('renders the message with an alert role', () => {
    render(<ErrorBanner message="Something went wrong" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/renderer/src/components/ui/ErrorBanner.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
import { AlertCircle } from 'lucide-react'
import { cn } from '../../lib/cn'

interface ErrorBannerProps {
  message: string
  className?: string
}

export function ErrorBanner({ message, className }: ErrorBannerProps): JSX.Element {
  return (
    <div
      role="alert"
      className={cn('flex items-center gap-2 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger', className)}
    >
      <AlertCircle size={16} aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/renderer/src/components/ui/ErrorBanner.test.tsx
```

Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ui/ErrorBanner.tsx src/renderer/src/components/ui/ErrorBanner.test.tsx
git commit -m "Add ErrorBanner primitive"
```

---

### Task 11: AppShell — wraps both screens with a themed top bar

**Files:**
- Create: `src/renderer/src/components/AppShell.tsx`
- Test: `src/renderer/src/components/AppShell.test.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `useTheme` from `../hooks/useTheme` (Task 2), `IconButton` from `./ui/IconButton` (Task 5)
- Produces: `AppShell({ children }): JSX.Element` — used by `App.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('renders its children', () => {
    render(
      <AppShell>
        <p>screen content</p>
      </AppShell>
    )
    expect(screen.getByText('screen content')).toBeInTheDocument()
  })

  it('toggles the theme when the toggle button is clicked', async () => {
    const user = userEvent.setup()
    render(
      <AppShell>
        <p>screen content</p>
      </AppShell>
    )
    const before = document.documentElement.dataset.theme
    await user.click(screen.getByRole('button'))
    expect(document.documentElement.dataset.theme).not.toBe(before)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/renderer/src/components/AppShell.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/renderer/src/components/AppShell.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { IconButton } from './ui/IconButton'

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-semibold">Demo Editor</span>
        <IconButton
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
      </header>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
```

Update `src/renderer/src/App.tsx`:

```tsx
import { useState } from 'react'
import { ProjectBrowser } from './screens/ProjectBrowser'
import { Editor } from './screens/Editor'
import { AppShell } from './components/AppShell'

export default function App(): JSX.Element {
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)

  return (
    <AppShell>
      {openProjectId ? <Editor projectId={openProjectId} /> : <ProjectBrowser onOpen={setOpenProjectId} />}
    </AppShell>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/renderer/src/components/AppShell.test.tsx
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/AppShell.tsx src/renderer/src/components/AppShell.test.tsx src/renderer/src/App.tsx
git commit -m "Add AppShell and wrap both screens with it"
```

---

### Task 12: Full plan verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

```bash
npm run test
```

Expected: PASS — all existing main-process tests (85 as of Plan 4) plus every new renderer test added in this plan (Tasks 2-11).

- [ ] **Step 2: Run the full typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Manually verify the theme toggle in the running app**

Launch the app in dev mode:

```bash
npm run dev
```

In the running window: confirm the app now shows a top bar with "Demo Editor" and a theme-toggle icon button; click it and confirm the whole window (background, text, borders) switches between light and dark; quit and relaunch the app and confirm the previously selected theme persisted. Confirm `ProjectBrowser` and `Editor` still behave exactly as before (list/create a project, open it, see the same buttons/panels) — only the surrounding chrome should look different due to the shell, since neither screen has been restyled yet.

- [ ] **Step 4: Clean up**

Stop the dev server (Ctrl+C).

- [ ] **Step 5: Final commit** (only if any of the above required fixes)

```bash
git add -A
git commit -m "Fix issues found in UI design system foundation verification"
```

If nothing needed fixing, there is nothing to commit — this plan is complete.
