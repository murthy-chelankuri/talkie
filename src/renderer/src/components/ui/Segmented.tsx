import { useRef, type KeyboardEvent } from 'react'
import { cn } from '../../lib/cn'

/**
 * One of a few choices, side by side — a scene's Brand / Light / Dark. A radio group underneath,
 * so a screen reader hears what it is and the arrow keys move between choices.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className
}: {
  label: string
  value: T
  options: { id: T; label: string }[]
  onChange: (id: T) => void
  className?: string
}): JSX.Element {
  const group = useRef<HTMLDivElement>(null)

  function onKeyDown(event: KeyboardEvent): void {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const index = options.findIndex((option) => option.id === value)
    const next = options[(index + step + options.length) % options.length]
    onChange(next.id)
    group.current?.querySelector<HTMLButtonElement>(`[data-id="${next.id}"]`)?.focus()
  }

  return (
    <div ref={group} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cn('flex gap-0.5 rounded-[9px] bg-raised p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          data-id={option.id}
          aria-checked={value === option.id}
          tabIndex={value === option.id ? 0 : -1}
          onClick={() => onChange(option.id)}
          className={cn(
            'flex-1 rounded-[7px] px-2 py-1 text-[12px] transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent',
            value === option.id ? 'bg-surface-hover font-medium text-text' : 'text-text-muted hover:text-text'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
