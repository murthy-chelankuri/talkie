import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn'

/** Whole seconds since `active` became true; 0 while it is not. */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) {
      setSeconds(0)
      return
    }
    const started = Date.now()
    setSeconds(0)
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [active])
  return seconds
}

/**
 * Something slow under way, said in words with the time it has taken so far.
 *
 * Writing words with a model takes from seconds to a minute, and voicing a long scene longer. It
 * was shown as a 12px spinner in place of a button's icon, which nobody looking at the words saw;
 * a scene that sat unchanged for half a minute read as the app having frozen. Words say what is
 * happening, and a count that keeps moving says it has not stopped.
 */
export function Working({ what, slowAfter = 20, slowNote, className }: { what: string; slowAfter?: number; slowNote?: string; className?: string }): JSX.Element {
  const seconds = useElapsedSeconds(true)
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium text-accent', className)}>
      <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden="true" />
      <span>
        {what}… <span className="tabular-nums text-text-muted">{seconds}s</span>
        {slowNote && seconds >= slowAfter && <span className="font-normal text-text-muted"> · {slowNote}</span>}
      </span>
    </span>
  )
}
