import { useId, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'

/** The one panel the rail has open, beside the stage. */
export function SidePanel({
  title,
  onClose,
  actions,
  children
}: {
  title: string
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
}): JSX.Element {
  const heading = useId()
  return (
    <section role="region" aria-labelledby={heading} className="flex h-full min-w-0 flex-col rounded-xl bg-surface">
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
        <h2 id={heading} className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">
          {title}
        </h2>
        {actions}
        <IconButton aria-label={`Close ${title}`} onClick={onClose} className="-mr-1.5">
          <X size={15} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
    </section>
  )
}
