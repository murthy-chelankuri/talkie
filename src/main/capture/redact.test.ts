import { describe, expect, it } from 'vitest'
import { shouldRedactInputValue } from './redact'

describe('what stays out of the action log', () => {
  it('redacts a password field, which is the one case a browser makes obvious', () => {
    expect(shouldRedactInputValue({ type: 'password' })).toBe(true)
  })

  it('still accepts a bare type, so the old call shape cannot half-land', () => {
    expect(shouldRedactInputValue('password')).toBe(true)
    expect(shouldRedactInputValue('text')).toBe(false)
  })

  /** All ordinary text fields, and all of them were previously written down verbatim. */
  it.each([
    ['one-time-code', { type: 'text', autocomplete: 'one-time-code' }],
    ['card number', { type: 'text', autocomplete: 'cc-number' }],
    ['card security code', { type: 'text', autocomplete: 'cc-csc' }],
    ['a billing-prefixed card field', { type: 'text', autocomplete: 'section-pay billing cc-number' }],
    ['a field named apiKey', { type: 'text', name: 'apiKey' }],
    ['a field named api_key', { type: 'text', name: 'api_key' }],
    ['a field named user_password', { type: 'text', name: 'user_password' }],
    ['a field whose id is otp', { type: 'text', id: 'otp' }],
    ['a field named cvv', { type: 'text', name: 'cvv' }],
    ['a field named ssn', { type: 'text', name: 'ssn' }],
    ['a field named accessToken', { type: 'text', name: 'accessToken' }]
  ])('redacts %s', (_label, field) => {
    expect(shouldRedactInputValue(field)).toBe(true)
  })

  it.each([
    ['a search box', { type: 'text', name: 'q' }],
    ['an ordinary email field', { type: 'email', autocomplete: 'email', name: 'email' }],
    ['a passport number, which is not a password', { type: 'text', name: 'passportNumber' }],
    ['a discard button field, which is not a card', { type: 'text', name: 'discardReason' }],
    ['a plain comment box', { type: 'text', name: 'comment' }]
  ])('leaves %s alone, so the narration keeps the detail', (_label, field) => {
    expect(shouldRedactInputValue(field)).toBe(false)
  })

  it('reads names case-insensitively, since pages write them every way', () => {
    expect(shouldRedactInputValue({ type: 'text', name: 'APIKey' })).toBe(true)
    expect(shouldRedactInputValue({ type: 'text', name: 'Card_Number' })).toBe(true)
  })

  it('copes with a field that says nothing about itself', () => {
    expect(shouldRedactInputValue({})).toBe(false)
  })
})
