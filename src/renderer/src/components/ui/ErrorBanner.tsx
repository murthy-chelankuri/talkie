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
