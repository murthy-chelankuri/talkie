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
