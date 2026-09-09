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
