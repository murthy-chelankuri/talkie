/**
 * Whether what was typed into a field should be kept out of the action log.
 *
 * The action log is read back by whatever drafts the narration, which for most providers means it
 * leaves the machine. `type="password"` was the only thing checked, and it is the one case
 * browsers make obvious — a one-time code, a card number and an API key are all ordinary text
 * fields, and all three were being written down verbatim and posted to a model.
 *
 * This reads the same hints a password manager reads. It is deliberately eager: a redacted value
 * costs the narration a detail it could have mentioned, and a leaked one costs a secret.
 *
 * It does not, and cannot, redact the recording itself. The video shows whatever the page showed;
 * a password field draws dots, an API key pasted into a text box does not.
 */
export interface CapturedField {
  /** The `type` attribute, which is the only signal a browser guarantees. */
  type?: string
  /** What the page told the browser this field is for. The strongest hint available. */
  autocomplete?: string
  /** Names and ids are how a page describes a field to itself, and they are usually honest. */
  name?: string
  id?: string
}

/** Values of `autocomplete` that say outright that this is a credential or a payment detail. */
const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-name',
  'cc-given-name',
  'cc-family-name',
  'cc-type'
])

/** Words that mean a secret on their own. */
const SENSITIVE_WORDS = new Set([
  'password', 'passwd', 'pwd', 'passcode', 'otp', 'totp', 'mfa', '2fa',
  'secret', 'token', 'credential', 'credentials', 'cvv', 'cvc', 'ssn',
  'pin', 'apikey', 'accesskey', 'privatekey', 'cardnumber', 'creditcard'
])

/** Words that mean a secret only next to each other — "access" and "key", but not either alone. */
const SENSITIVE_PAIRS = new Set([
  'apikey', 'accesskey', 'privatekey', 'secretkey', 'cardnumber', 'creditcard',
  'debitcard', 'taxid', 'accountnumber', 'routingnumber', 'securitycode', 'authtoken'
])

/**
 * A field's name as the words it is made of.
 *
 * Splitting matters more than it looks. Matching on substrings alone would redact every
 * `shippingAddress`, because "shipping" contains "pin"; matching on separators alone would miss
 * `accessToken`, because camel case puts no separator anywhere. Both shapes are ordinary, so both
 * are split here — and `passport` and `discard` stay whole, which is what keeps them out of it.
 */
function wordsIn(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

function namesASecret(name: string | undefined): boolean {
  if (!name) return false
  const words = wordsIn(name)

  if (words.some((word) => SENSITIVE_WORDS.has(word))) return true
  return words.some((word, index) => index > 0 && SENSITIVE_PAIRS.has(words[index - 1] + word))
}

/** Field types whose value is a credential by definition. */
const SENSITIVE_TYPE = new Set(['password'])

export function shouldRedactInputValue(field: CapturedField | string): boolean {
  // Callers used to pass the type alone; keeping that working means the change cannot half-land.
  const captured: CapturedField = typeof field === 'string' ? { type: field } : field

  if (SENSITIVE_TYPE.has((captured.type ?? '').toLowerCase())) return true

  // `autocomplete` may carry section and billing/shipping prefixes — "section-x billing cc-number"
  // — so the meaningful part is the last token.
  const autocomplete = (captured.autocomplete ?? '').toLowerCase().trim().split(/\s+/).pop() ?? ''
  if (SENSITIVE_AUTOCOMPLETE.has(autocomplete)) return true

  return namesASecret(captured.name) || namesASecret(captured.id)
}
