/**
 * What an unattended recorder is allowed to touch.
 *
 * Exploring an app on its own means clicking things nobody looked at first, on what may well be
 * a real production system with real customer data behind it. A recording is a terrible place to
 * discover that something was destructive: by the time anyone watches the video, the record is
 * already gone.
 *
 * So this is an allowlist, not a blocklist. Something is clickable only if it reads as a way of
 * getting somewhere — a link, a tab, a menu item — and even then only if nothing about it
 * suggests it acts rather than navigates. Anything unrecognised is left alone. Being too timid
 * costs a duller demo; being too bold costs someone their data.
 *
 * Nothing here types, and nothing here submits. Those are not judgement calls this makes well.
 */

/**
 * Words that mean a control does something rather than goes somewhere.
 *
 * Matched as whole words, so "Deleted items" stays clickable — it is a place — while "Delete"
 * does not. Deliberately over-broad: "Cancel" is usually a harmless dialog dismissal and
 * occasionally the end of someone's subscription, and there is no way to tell from the label
 * which one it is. Skipping a few safe buttons is the cheaper mistake.
 */
export const ACTING_WORDS = [
  'delete',
  'remove',
  'destroy',
  'discard',
  'trash',
  'archive',
  'cancel',
  'unsubscribe',
  'deactivate',
  'disable',
  'revoke',
  'reset',
  'clear',
  'empty',
  'send',
  'submit',
  'save',
  'publish',
  'deploy',
  'merge',
  'approve',
  'reject',
  'decline',
  'confirm',
  'pay',
  'buy',
  'purchase',
  'checkout',
  'order',
  'subscribe',
  'upgrade',
  'downgrade',
  'transfer',
  'withdraw',
  'invite',
  'share',
  'block',
  'ban',
  'report',
  'apply',
  'update',
  'create',
  'add',
  'new',
  'edit',
  'rename',
  'move',
  'import',
  'export',
  'upload',
  'install',
  'uninstall',
  'restart',
  'stop',
  'start',
  'run',
  'execute'
]

/**
 * Words that end the session rather than damage anything.
 *
 * Not destructive, but a recorder that signs itself out has finished the demo early and left
 * every later scene showing a login screen.
 */
export const LEAVING_WORDS = ['log out', 'logout', 'sign out', 'signout', 'log off', 'exit']

/**
 * Words that put the walk in front of a sign-in rather than further into the app.
 *
 * "Continue with Acme" hands it to a provider it cannot type into, usually in a window it was
 * not watching; "Sign up" starts creating an account; "Forgot password" sends an email. None of
 * them is a part of the app being demonstrated, and all of them strand the walk exactly where it
 * can do least — which is what someone watching reports as the recording never getting past the
 * login.
 *
 * Refusing them also settles what a sign-in screen is. A page asking for an identifier whose
 * only controls are these now has nowhere to go, which is the shape authWall.ts recognises and
 * waits at. Before this, one "Continue with Google" button was enough for the page to count as
 * somewhere the walk could get on to, so it was never a wall, nobody was ever waited for, and
 * the walk clicked the button and sat reading the login page it had never left.
 */
export const ENTERING_WORDS = [
  'sign in',
  'signin',
  'sign-in',
  'log in',
  'login',
  'log-in',
  'sign up',
  'signup',
  'sign-up',
  'register',
  'continue with',
  'create account',
  'create an account',
  'forgot password',
  'single sign-on'
]

/** Roles that exist to move you somewhere, which is all this is allowed to do. */
const NAVIGATING_ROLES = ['tab', 'menuitem', 'menuitemradio', 'treeitem', 'option', 'link']

/** Schemes that leave the browser or run script rather than going to a page. */
const OFF_PAGE_SCHEMES = /^(mailto|tel|sms|javascript|file|data|blob):/i

/** One thing on the page the recorder could click, as the page described itself. */
export interface Candidate {
  /** A selector the recorder can click, built by the page-reading script. */
  selector: string
  /** What it says, which is all there is to judge it by. */
  label: string
  tag: string
  role?: string
  href?: string
  /** Inside a `<form>`, so activating it may submit the form around it. */
  inForm?: boolean
  disabled?: boolean
}

/** Whether this control leads to signing in rather than to anywhere in the app. */
export function leadsToSignIn(label: string): boolean {
  const words = label.toLowerCase()
  return ENTERING_WORDS.some((phrase) => words.includes(phrase))
}

export function looksLikeActing(label: string): boolean {
  const words = label.toLowerCase()
  return (
    ACTING_WORDS.some((word) => new RegExp(`\\b${word}\\b`).test(words)) ||
    LEAVING_WORDS.some((phrase) => words.includes(phrase))
  )
}

/** Whether a link goes somewhere in the same app, rather than off it or out of the browser. */
export function staysInApp(href: string | undefined, origin: string): boolean {
  if (!href) return false
  if (OFF_PAGE_SCHEMES.test(href)) return false
  // A fragment or a relative path is this app by definition.
  if (href.startsWith('#') || href.startsWith('/') || !/^[a-z][a-z0-9+.-]*:/i.test(href)) return true

  try {
    return new URL(href).origin === origin
  } catch {
    return false
  }
}

/**
 * Whether the recorder may click this, given the app it is exploring.
 *
 * Read the order as the argument: anything disabled or unlabelled is not a target; anything
 * whose words suggest it acts, or that it leads to a sign-in rather than into the app, is out
 * however it is marked up; a link is in if it stays in the app; a tab or menu item is in; a
 * button is in only when it is not sitting inside a form, because a button in a form is one
 * keystroke from submitting it. Everything else is out.
 */
export function safeToClick(candidate: Candidate, origin: string): boolean {
  const label = candidate.label.trim()
  if (candidate.disabled || label.length === 0) return false
  if (looksLikeActing(label) || leadsToSignIn(label)) return false

  const tag = candidate.tag.toLowerCase()
  const role = candidate.role?.toLowerCase()

  // Nothing that takes input is ever touched: this looks, it does not fill things in.
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false

  if (tag === 'a' || role === 'link') return staysInApp(candidate.href, origin)
  if (role && NAVIGATING_ROLES.includes(role)) return true
  if (tag === 'button' || role === 'button') return !candidate.inForm

  return false
}

/** Everything on the page worth offering the model, in the order the page listed it. */
export function safeCandidates(candidates: Candidate[], origin: string): Candidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (!safeToClick(candidate, origin)) return false
    // The same nav link in a header and a footer is one choice, not two.
    const key = `${candidate.label.trim().toLowerCase()}|${candidate.href ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
