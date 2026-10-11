import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface RailItem {
  id: string
  label: string
  icon: ReactNode
  /** Shown in the tooltip, e.g. "⌘1". The shortcut itself is the caller's to handle. */
  shortcut?: string
}

/**
 * The strip down the editor's left edge: one tab per panel, at most one open. Labelled under each
 * icon as well as named — four unlabelled glyphs is a guessing game the first week.
 */
export function Rail({
  label,
  items,
  selected,
  onSelect
}: {
  label: string
  items: RailItem[]
  selected: string | null
  onSelect: (id: string) => void
}): JSX.Element {
  return (
    <div role="tablist" aria-label={label} aria-orientation="vertical" className="flex w-[52px] shrink-0 flex-col items-center gap-2 pt-1">
      {items.map((item) => {
        const on = selected === item.id
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={item.label}
            title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
            onClick={() => onSelect(item.id)}
            className="group flex flex-col items-center gap-1 focus-visible:outline-none"
          >
            <span
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors group-focus-visible:ring-2 group-focus-visible:ring-accent',
                on ? 'bg-accent-soft text-text ring-1 ring-inset ring-accent/50' : 'text-text-muted hover:bg-raised hover:text-text'
              )}
            >
              {item.icon}
            </span>
            <span className={cn('text-[10px] leading-none', on ? 'text-text' : 'text-text-muted')}>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
