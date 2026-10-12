import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '../../lib/cn'

/**
 * A column's width, kept between its limits and remembered on this Mac.
 *
 * The side panel and the inspector come and go, which a fixed column with an edge to drag handles
 * more simply than adding and removing panels from a resizable group.
 */
export function useResizableWidth(key: string, initial: number, min: number, max: number): [number, (width: number) => void] {
  const clamp = useCallback((value: number) => Math.round(Math.min(max, Math.max(min, value))), [min, max])
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key))
      return saved ? clamp(saved) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, String(width))
    } catch {
      // A width not remembered is the default next time; nothing else depends on it.
    }
  }, [key, width])
  return [width, (next) => setWidth(clamp(next))]
}

/**
 * The edge between a column and the stage. Dragged, or moved with the arrow keys once focused —
 * a separator a keyboard cannot move is one that only some people can use.
 */
export function ResizeHandle({
  label,
  width,
  onWidth,
  side
}: {
  label: string
  width: number
  onWidth: (width: number) => void
  /** Which side of the stage the column is on, so dragging towards the stage widens it. */
  side: 'left' | 'right'
}): JSX.Element {
  const start = useRef<{ x: number; width: number } | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    start.current = { x: event.clientX, width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!start.current) return
    const moved = event.clientX - start.current.x
    onWidth(start.current.width + (side === 'left' ? moved : -moved))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 40 : 10
    if (event.key === 'ArrowRight') onWidth(width + (side === 'left' ? step : -step))
    else if (event.key === 'ArrowLeft') onWidth(width + (side === 'left' ? -step : step))
    else return
    event.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (start.current = null)}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative w-2 shrink-0 cursor-col-resize focus-visible:outline-none'
      )}
    >
      <span className="absolute inset-y-3 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover:bg-accent/60 group-focus-visible:bg-accent" />
    </div>
  )
}
