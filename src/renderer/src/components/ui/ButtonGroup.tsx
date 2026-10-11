import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

/** Related controls on one raised pill, so a row of tools reads as one tool rather than many boxes. */
export function ButtonGroup({ className, ...props }: HTMLAttributes<HTMLDivElement> & { 'aria-label': string }): JSX.Element {
  return <div role="group" className={cn('inline-flex items-center gap-0.5 rounded-[10px] bg-raised p-0.5', className)} {...props} />
}
