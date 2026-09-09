import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Button } from './Button'
import { cn } from '../../lib/cn'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string
  children: ReactNode
}

export function IconButton({ className, children, ...props }: IconButtonProps): JSX.Element {
  return (
    <Button variant="icon" size="sm" className={cn('h-8 w-8 p-0', className)} {...props}>
      {children}
    </Button>
  )
}
