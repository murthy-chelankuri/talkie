import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'primary' | 'gradient' | 'soft' | 'secondary' | 'ghost' | 'icon' | 'danger'
export type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

/**
 * Studio: no outlines. The main action sits on the accent gradient in dark ink — white falls to
 * 2:1 at its cyan end — and AI actions are tinted with it rather than filled, so there is only
 * ever one loud thing on screen. 'primary' is the gradient, so no call site had to change.
 */
const GRADIENT = 'bg-accent-gradient text-on-gradient hover:brightness-110'
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: GRADIENT,
  gradient: GRADIENT,
  soft: 'bg-accent-soft text-accent ring-1 ring-inset ring-accent/35 hover:brightness-125',
  secondary: 'bg-raised text-text hover:bg-surface-hover',
  ghost: 'bg-transparent text-text hover:bg-raised',
  icon: 'bg-transparent text-text-muted hover:bg-raised hover:text-text',
  danger: 'bg-danger text-white hover:brightness-110'
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2 text-sm',
  md: 'h-9 px-3 text-sm'
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps): JSX.Element {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-[9px] font-medium transition-[background-color,color,filter] disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    />
  )
}
