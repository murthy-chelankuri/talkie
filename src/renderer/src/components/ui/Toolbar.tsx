import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type ToolbarProps = HTMLAttributes<HTMLDivElement>

export function Toolbar({ className, ...props }: ToolbarProps): JSX.Element {
  return (
    <div role="toolbar" className={cn('flex items-center gap-1 border-b border-border bg-surface p-2', className)} {...props} />
  )
}
