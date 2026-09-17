import { shouldRedactInputValue, type CapturedField } from './redact'

/**
 * Recognising the point where an app stops being explorable without a person.
 *
 * Most apps worth demoing are behind a login, and a good many are behind a second factor after
 * that. The recorder cannot get past either: it never types, and it could not produce a one-time
 * code if it did. What it can do is notice, say so, and wait — the browser is real and on
 * screen, so the person signs in themselves and the walk picks up on the other side.
 *
 * Noticing matters more than it sounds. Without it the walk finds nothing safe to click, decides
 * the app has no more to show, and ends — leaving a recording of a login screen and no
 * explanation. That reads as the feature being broken rather than as the app needing a password.
 */

/** Words that name the wall itself, used only to describe what is being waited for. */
const SECOND_FACTOR_WORDS = ['one-time', 'one time', 'verification code', 'authenticator', 'two-factor', '2fa', 'otp', 'passcode', 'security code']

const SIGN_IN_WORDS = ['sign in', 'signin', 'log in', 'login', 'sign up', 'register', 'continue with', 'password']

export interface WallReading {
  url: string
  title: string
  heading: string
  text: string
  fields?: CapturedField[]
  candidates: unknown[]
}

export type Wall = { kind: 'sign-in' | 'second-factor'; asking: string } | null

/**
 * Whether this page is asking a person for something only they have.
 *
 * A field the redactor would hide is the signal, because that is the same question asked from
 * the other end: those are exactly the fields whose values must never be written down, and they
 * are exactly the ones nobody but the user can fill. Reusing it means a page that hides a
 * one-time code from the action log also stops the walk, and the two cannot drift apart.
 */
export function authWall(reading: WallReading): Wall {
  const fields = reading.fields ?? []
  const secret = fields.find((field) => shouldRedactInputValue(field))
  const words = `${reading.title} ${reading.heading} ${reading.text}`.toLowerCase()

  if (secret) {
    // Which of the two it is changes what the person has to go and fetch — a password they know
    // against a code on another device — so it is worth telling them apart.
    const named = `${secret.name ?? ''} ${secret.id ?? ''} ${secret.autocomplete ?? ''}`.toLowerCase()
    const secondFactor =
      SECOND_FACTOR_WORDS.some((word) => words.includes(word)) || /otp|totp|mfa|2fa/.test(named)

    return secondFactor
      ? { kind: 'second-factor', asking: 'your verification code' }
      : { kind: 'sign-in', asking: 'your sign-in details' }
  }

  // A wall with no field of its own yet: the single-sign-on button, or an email-first form that
  // asks for the password on the next screen. There is nowhere safe to go from here either.
  if (reading.candidates.length === 0 && fields.length > 0 && SIGN_IN_WORDS.some((word) => words.includes(word))) {
    return { kind: 'sign-in', asking: 'your sign-in details' }
  }

  return null
}
