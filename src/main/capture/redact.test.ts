import { describe, expect, it } from 'vitest'
import { shouldRedactInputValue } from './redact'

describe('shouldRedactInputValue', () => {
  it('redacts password inputs', () => {
    expect(shouldRedactInputValue('password')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(shouldRedactInputValue('PASSWORD')).toBe(true)
  })

  it('does not redact ordinary text inputs', () => {
    expect(shouldRedactInputValue('text')).toBe(false)
  })

  it('does not redact email inputs', () => {
    expect(shouldRedactInputValue('email')).toBe(false)
  })
})
