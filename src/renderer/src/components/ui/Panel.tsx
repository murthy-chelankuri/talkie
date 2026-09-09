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
