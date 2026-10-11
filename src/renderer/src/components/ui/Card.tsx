import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type CardProps = HTMLAttributes<HTMLDivElement>

export function Card({ className, ...props }: CardProps): JSX.Element {
  return <div className={cn('rounded-xl bg-surface p-4', className)} {...props} />
}
