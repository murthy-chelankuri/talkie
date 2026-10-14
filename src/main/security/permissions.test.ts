import { describe, expect, it } from 'vitest'
import { mayUse } from './permissions'

describe('what the renderer may ask the system for', () => {
  it('lets the preview fill the screen', () => {
    // The fullscreen button called the player, the player called the browser, and Electron refused
    // because the rule named only the microphone. Nothing happened and nothing was said.
    expect(mayUse('fullscreen')).toBe(true)
  })

  it('lets a narration take be recorded in your own voice', () => {
    expect(mayUse('media')).toBe(true)
  })

  it('lets a Copy button put text on the clipboard, but not read what is already there', () => {
    // writeText asks for this one; refused, the token's Copy button copied nothing and said nothing.
    expect(mayUse('clipboard-sanitized-write')).toBe(true)
    expect(mayUse('clipboard-read')).toBe(false)
  })

  it('refuses everything else, including what it has never heard of', () => {
    // Deny by default: the list Electron can be asked for grows, and a permission added to it
    // upstream should arrive refused rather than granted.
    for (const permission of [
      'geolocation',
      'display-capture',
      'clipboard-read',
      'notifications',
      'midiSysex',
      'openExternal',
      'window-management',
      'idle-detection',
      'something-invented-later'
    ]) {
      expect(mayUse(permission)).toBe(false)
    }
  })
})
