import { describe, expect, it } from 'vitest'
import { authWall, type WallReading } from './authWall'

function page(over: Partial<WallReading> = {}): WallReading {
  return {
    url: 'https://app.test/',
    title: 'Acme',
    heading: 'Dashboard',
    text: 'Your portfolio is up 3% today.',
    fields: [],
    candidates: [{}],
    ...over
  }
}

describe('noticing that an app wants a person', () => {
  it('stops at a password field', () => {
    const wall = authWall(
      page({
        title: 'Sign in — Acme',
        heading: 'Sign in',
        fields: [{ type: 'email', name: 'email' }, { type: 'password', name: 'password' }]
      })
    )

    expect(wall?.kind).toBe('sign-in')
    expect(wall?.asking).toContain('sign-in')
  })

  it('tells a second factor apart from a password, because they send you somewhere different', () => {
    // One is something you know, the other is a code on another device. Saying which decides
    // whether the person reaches for their phone.
    const wall = authWall(
      page({
        title: 'Verify — Acme',
        heading: 'Enter your verification code',
        text: 'We sent a one-time code to your phone.',
        fields: [{ type: 'text', name: 'otp', autocomplete: 'one-time-code' }]
      })
    )

    expect(wall?.kind).toBe('second-factor')
    expect(wall?.asking).toContain('verification code')
  })

  it('reads a second factor from the field name when the page says nothing', () => {
    const wall = authWall(
      page({ heading: 'Almost there', fields: [{ type: 'text', name: 'totp_token' }] })
    )

    expect(wall?.kind).toBe('second-factor')
  })

  it('lets a signed-in page through even when its title still says the login page did', () => {
    // The shape that cost a whole recording: the person signs in, the app routes without
    // reloading so <title> still reads "Sign in", the dashboard has a search box, and nothing on
    // it is something the allowlist would click. Read as a wall, the walk waited five minutes
    // for a sign-in that had already happened and then reported that nobody ever signed in.
    const wall = authWall(
      page({
        title: 'Acme — Sign in',
        heading: 'Dashboard',
        text: 'Welcome back. Your portfolio is up 3% today.',
        fields: [{ type: 'text', name: 'q' }],
        candidates: []
      })
    )

    expect(wall).toBeNull()
  })

  it('still stops when the only field is one a person is identified by', () => {
    // The same page shape, and the difference that matters: an email box rather than a search
    // box means this is the first half of a sign-in, not the far side of one.
    const wall = authWall(
      page({
        title: 'Acme — Sign in',
        heading: 'Sign in',
        fields: [{ type: 'email', name: 'email' }],
        candidates: []
      })
    )

    expect(wall?.kind).toBe('sign-in')
  })

  it('stops at a single-sign-on page that has no field of its own yet', () => {
    // Email-first forms and "continue with" buttons ask on the next screen. There is nowhere
    // safe to go from here either, so waiting is still the right move.
    const wall = authWall(
      page({
        title: 'Log in',
        heading: 'Log in to Acme',
        fields: [{ type: 'email', name: 'email' }],
        candidates: []
      })
    )

    expect(wall?.kind).toBe('sign-in')
  })

  it('lets an ordinary page through', () => {
    expect(authWall(page())).toBeNull()
  })

  it('does not mistake a search box on a working page for a login', () => {
    // A page with fields and somewhere to go is a page being used, not a wall.
    expect(authWall(page({ fields: [{ type: 'text', name: 'q' }] }))).toBeNull()
  })

  it('does not stop on a page that merely mentions signing in', () => {
    // Plenty of marketing pages have a "Log in" link in the corner. Words alone are not a wall;
    // there has to be nowhere else to go.
    expect(authWall(page({ text: 'Log in to get started', candidates: [{}, {}] }))).toBeNull()
  })
})
