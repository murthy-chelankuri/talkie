import { describe, expect, it } from 'vitest'
import { whatWentWrong } from './claudeCliProvider'

/** What `execFile` rejects with: a message built from the command line, plus the child's output. */
function failed(over: { stderr?: string; killed?: boolean } = {}): Error {
  const err = new Error(
    'Command failed: /Users/me/.local/bin/claude -p You are recording a demo of d2 by walking ' +
      'through the app yourself. You are on: Ledger — Stock Analysis Agent …'
  )
  return Object.assign(err, over)
}

describe('saying why the claude CLI did not answer', () => {
  it('reports what the CLI said, not the question it was asked', () => {
    // execFile builds its message out of the command line, and the command line here is the
    // whole prompt — so a failure arrived as several hundred words of the question quoted
    // back, with the reason nowhere in it.
    const said = whatWentWrong(failed({ stderr: 'Usage limit reached. Resets at 3pm.' }))

    expect(said).toBe('Usage limit reached. Resets at 3pm.')
    expect(said).not.toContain('recording a demo')
  })

  it('steps over the CLI chatter to the line that is the complaint', () => {
    const stderr = [
      'Warning: no stdin data received in 3s, proceeding without it.',
      'Error: not logged in. Run `claude login`.'
    ].join('\n')

    expect(whatWentWrong(failed({ stderr }))).toBe('Error: not logged in. Run `claude login`.')
  })

  it('says it timed out rather than quoting the prompt back', () => {
    expect(whatWentWrong(failed({ killed: true }))).toBe('it took too long to answer')
  })

  it('says it exited without answering when it left nothing behind', () => {
    expect(whatWentWrong(failed())).toBe('it exited without answering')
  })

  it('passes through a failure that is not a command line at all', () => {
    expect(whatWentWrong(new Error('spawn ENOENT'))).toBe('spawn ENOENT')
  })
})
