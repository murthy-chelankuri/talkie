import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { homedir } from 'os'
import { readSettings, updateSettings } from './settingsStore'

/** Long enough that guessing is not a strategy, short enough to paste into a config by hand. */
const TOKEN_BYTES = 32

export type AccessRefusal = 'disabled' | 'no-token' | 'missing-token' | 'wrong-token'

export interface AccessResult {
  allowed: boolean
  refusedBecause?: AccessRefusal
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Make a token, keep only its hash, and hand the token back once.
 *
 * Once is the whole point: what is stored cannot be turned back into the token, so a settings
 * file that leaks does not carry a working credential with it. Losing it costs one more click.
 */
export function createMcpToken(baseDir: string = homedir()): string {
  const token = `talkie_${randomBytes(TOKEN_BYTES).toString('base64url')}`

  updateSettings(
    { mcp: { tokenHash: hashToken(token), tokenCreatedAt: new Date().toISOString() } },
    baseDir
  )

  return token
}

/** Withdraw the current token. Any agent still holding it stops working at its next call. */
export function revokeMcpToken(baseDir: string = homedir()): void {
  updateSettings({ mcp: { tokenHash: '', tokenCreatedAt: '' } }, baseDir)
}

/**
 * Whether a presented token may drive Talkie right now.
 *
 * Read fresh every time rather than held from startup, so turning the switch off or replacing
 * the token takes effect on the next call instead of when the agent next restarts. That is the
 * difference between a setting and a suggestion.
 */
export function checkMcpAccess(presented: string | undefined, baseDir: string = homedir()): AccessResult {
  const { mcp } = readSettings(baseDir)

  // The switch first, for everyone. Talkie's own agent is a child process like any other and
  // gets no way round it.
  if (!mcp.enabled) return { allowed: false, refusedBecause: 'disabled' }
  if (!mcp.tokenHash && !mcp.runTokenHash) return { allowed: false, refusedBecause: 'no-token' }
  if (!presented) return { allowed: false, refusedBecause: 'missing-token' }

  const presentedHash = hashToken(presented)
  // Either the standing token an outside agent was given, or the one minted for the run
  // happening right now. Two slots so that asking Talkie to do something cannot revoke the
  // token something else is already using.
  const accepted =
    (mcp.tokenHash && matches(presentedHash, mcp.tokenHash)) ||
    (mcp.runTokenHash && matches(presentedHash, mcp.runTokenHash))

  return accepted ? { allowed: true } : { allowed: false, refusedBecause: 'wrong-token' }
}

/**
 * Mint a token for one run of Talkie's own agent, and hand back the way to withdraw it.
 *
 * Hashed and written to settings like any other, because the thing that checks it is a separate
 * process reading the same file. Withdrawn in a `finally` rather than left to expire: a token
 * that outlives the run it was made for is just a second permanent credential. It still only
 * works while agent access is turned on.
 */
export function grantRunToken(baseDir: string = homedir()): { token: string; withdraw: () => void } {
  const token = `talkie_run_${randomBytes(TOKEN_BYTES).toString('base64url')}`
  updateSettings({ mcp: { runTokenHash: hashToken(token) } }, baseDir)

  return {
    token,
    withdraw: () => updateSettings({ mcp: { runTokenHash: '' } }, baseDir)
  }
}

/** What to tell whoever was refused, in terms of what they can do about it. */
export function explainRefusal(reason: AccessRefusal): string {
  switch (reason) {
    case 'disabled':
      return 'Talkie is not accepting agent connections. Turn on "Let AI agents connect" in Talkie’s Settings → System.'
    case 'no-token':
      return 'Talkie has no access token. Create one in Talkie’s Settings → System, then put it in this server’s TALKIE_MCP_TOKEN.'
    case 'missing-token':
      return 'No token was presented. Set TALKIE_MCP_TOKEN in this server’s configuration to the token from Talkie’s Settings → System.'
    case 'wrong-token':
      return 'That token is not the current one. It may have been replaced — create a new one in Talkie’s Settings → System and update this server’s TALKIE_MCP_TOKEN.'
  }
}

/** Compared without letting the time taken say how much of the hash was right. */
function matches(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}
