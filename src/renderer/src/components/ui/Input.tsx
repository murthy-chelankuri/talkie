import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type InputProps = InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...props }: InputProps): JSX.Element {
  return (
    <input
      className={cn(
        'h-9 rounded-[9px] border-0 bg-raised px-3 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
