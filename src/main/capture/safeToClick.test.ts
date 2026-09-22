import { describe, expect, it } from 'vitest'
import {
  safeCandidates,
  safeToClick,
  looksLikeActing,
  leadsToSignIn,
  staysInApp,
  type Candidate
} from './safeToClick'

const ORIGIN = 'https://app.example.com'

function candidate(over: Partial<Candidate> = {}): Candidate {
  return { selector: '#x', label: 'Pricing', tag: 'a', href: '/pricing', ...over }
}

describe('what an unattended recorder may click', () => {
  it('follows a link that stays in the app', () => {
    expect(safeToClick(candidate(), ORIGIN)).toBe(true)
    expect(safeToClick(candidate({ href: `${ORIGIN}/reports` }), ORIGIN)).toBe(true)
    expect(safeToClick(candidate({ href: '#section' }), ORIGIN)).toBe(true)
  })

  it('will not wander off the app it was pointed at', () => {
    // A demo that ends up on someone's marketing site or a third-party docs page has stopped
    // recording the thing it was asked to record.
    expect(safeToClick(candidate({ href: 'https://elsewhere.test/x' }), ORIGIN)).toBe(false)
  })

  it('will not leave the browser or run script through an href', () => {
    for (const href of ['mailto:a@b.test', 'tel:+441234', 'javascript:alert(1)', 'file:///etc/passwd']) {
      expect(safeToClick(candidate({ href }), ORIGIN)).toBe(false)
    }
  })

  it('opens tabs and menu items, which are how an app shows you round itself', () => {
    expect(safeToClick(candidate({ tag: 'div', role: 'tab', href: undefined }), ORIGIN)).toBe(true)
    expect(safeToClick(candidate({ tag: 'li', role: 'menuitem', href: undefined }), ORIGIN)).toBe(true)
  })

  it('never touches anything that takes input', () => {
    // This looks; it does not fill things in. A recorder typing into a real app is a recorder
    // writing to it.
    for (const tag of ['input', 'textarea', 'select']) {
      expect(safeToClick(candidate({ tag, href: undefined, label: 'Search' }), ORIGIN)).toBe(false)
    }
  })

  it('leaves a button inside a form alone, being one keystroke from submitting it', () => {
    expect(safeToClick(candidate({ tag: 'button', href: undefined, inForm: true }), ORIGIN)).toBe(false)
    expect(safeToClick(candidate({ tag: 'button', href: undefined, inForm: false }), ORIGIN)).toBe(true)
  })

  it('refuses anything whose words say it acts rather than goes somewhere', () => {
    // The whole risk of exploring unattended: by the time anyone watches the video, whatever
    // this clicked has already happened.
    for (const label of [
      'Delete',
      'Delete project',
      'Remove member',
      'Cancel subscription',
      'Send invoice',
      'Pay now',
      'Deploy to production',
      'Revoke access',
      'Reset password',
      'Approve request'
    ]) {
      expect(safeToClick(candidate({ label, tag: 'button', href: undefined }), ORIGIN)).toBe(false)
    }
  })

  it('judges the words, not the markup, so a destructive link is still refused', () => {
    // Plenty of apps wire a delete to an <a>. The tag says nothing about what happens.
    expect(safeToClick(candidate({ label: 'Delete account', href: '/settings/delete' }), ORIGIN)).toBe(false)
  })

  it('will not sign itself out and spend the rest of the demo on a login screen', () => {
    for (const label of ['Log out', 'Sign out', 'Logout']) {
      expect(safeToClick(candidate({ label, tag: 'button', href: undefined }), ORIGIN)).toBe(false)
    }
  })

  it('reads acting words as whole words, so a place named after one stays reachable', () => {
    // "Deleted items" is somewhere to look at, not something that deletes.
    expect(looksLikeActing('Deleted items')).toBe(false)
    expect(looksLikeActing('Archived')).toBe(false)
    expect(looksLikeActing('Delete')).toBe(true)
  })

  it('refuses anything it does not recognise rather than trying it', () => {
    // The default has to be no: an unrecognised control is one nobody has reasoned about.
    expect(safeToClick(candidate({ tag: 'div', href: undefined, role: undefined }), ORIGIN)).toBe(false)
    expect(safeToClick(candidate({ tag: 'span', href: undefined, role: 'slider' }), ORIGIN)).toBe(false)
  })

  it('skips what is disabled or says nothing', () => {
    expect(safeToClick(candidate({ disabled: true }), ORIGIN)).toBe(false)
    expect(safeToClick(candidate({ label: '   ' }), ORIGIN)).toBe(false)
  })

  it('offers the same nav link once however many times the page repeats it', () => {
    const header = candidate({ selector: 'header a', label: 'Reports', href: '/reports' })
    const footer = candidate({ selector: 'footer a', label: 'Reports', href: '/reports' })

    expect(safeCandidates([header, footer], ORIGIN)).toHaveLength(1)
  })

  it('keeps the page order, which is the order someone would read them in', () => {
    const list = [
      candidate({ label: 'Overview', href: '/' }),
      candidate({ label: 'Delete', tag: 'button', href: undefined }),
      candidate({ label: 'Reports', href: '/reports' })
    ]

    expect(safeCandidates(list, ORIGIN).map((c) => c.label)).toEqual(['Overview', 'Reports'])
  })

  it('treats a relative href as this app without needing to parse it', () => {
    expect(staysInApp('reports/2024', ORIGIN)).toBe(true)
    expect(staysInApp(undefined, ORIGIN)).toBe(false)
  })
})

describe('the way into an app, which is not a way round it', () => {
  it('leaves a provider button alone, however inviting it looks', () => {
    // Clicking it opens a window the walk cannot type into, and leaves the demo standing at
    // someone else's login. The person has to do this part; the walk waits for them.
    for (const label of ['Continue with Google', 'Sign in with Apple', 'Single sign-on']) {
      expect(safeToClick(candidate({ label, tag: 'button', href: undefined }), ORIGIN)).toBe(false)
    }
  })

  it('leaves alone the rest of what a login screen offers', () => {
    // None of these is the app: registering makes an account, and a forgotten password is an
    // email nobody asked this to send.
    for (const label of ['Sign up', 'Create an account', 'Register', 'Forgot password?']) {
      expect(leadsToSignIn(label)).toBe(true)
      expect(safeToClick(candidate({ label, href: '/x' }), ORIGIN)).toBe(false)
    }
  })

  it('leaves a sign-in screen with nowhere to go, which is what makes it a wall', () => {
    // authWall.ts calls a page a sign-in when it asks for an identifier and there is nowhere on
    // it to go. One provider button used to be enough to count as somewhere, so the wall was
    // never recognised, nobody was waited for, and the walk clicked the button.
    const screen = [
      candidate({ label: 'Continue with Acme', tag: 'button', href: undefined }),
      candidate({ label: 'Create an account', href: '/signup' }),
      candidate({ label: 'Email', tag: 'input', href: undefined })
    ]

    expect(safeCandidates(screen, ORIGIN)).toEqual([])
  })

  it('still opens the parts of an app that only read like a sign-in', () => {
    // The words have to mean the control leads to signing in. A page about who has signed in is
    // an ordinary screen and one worth showing.
    expect(leadsToSignIn('Members')).toBe(false)
    expect(safeToClick(candidate({ label: 'Members', href: '/members' }), ORIGIN)).toBe(true)
    expect(safeToClick(candidate({ label: 'Sessions', href: '/sessions' }), ORIGIN)).toBe(true)
  })

  it('does not confuse signing in with signing out, which is refused for its own reason', () => {
    expect(looksLikeActing('Sign out')).toBe(true)
    expect(leadsToSignIn('Sign out')).toBe(false)
  })
})
