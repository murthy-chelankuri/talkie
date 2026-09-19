import { describe, expect, it } from 'vitest'
import { mayUse } from './permissions'

describe('what the renderer may ask the system for', () => {
  it('lets the preview fill the screen', () => {
    // The fullscreen button called Remotion, Remotion called the browser, and Electron refused
    // because the rule named only the microphone. Nothing happened and nothing was said.
    expect(mayUse('fullscreen')).toBe(true)
  })

  it('lets a narration take be recorded in your own voice', () => {
    expect(mayUse('media')).toBe(true)
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
