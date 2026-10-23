// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { applyTheme } from './theme'
import type { SceneTheme } from '../protocol'

// jsdom has no FontFace; the real scene host is a browser. The font-loading path is not under
// test here — only the CSS variables and the injected background layer — so a stub that resolves
// is enough to let applyTheme run to the end.
beforeAll(() => {
  if (!('FontFace' in globalThis)) {
    ;(globalThis as { FontFace?: unknown }).FontFace = class {
      load(): Promise<unknown> {
        return Promise.resolve(this)
      }
    }
  }
})

const base: SceneTheme = {
  background: '#111111',
  heading: '#ffffff',
  body: '#cccccc',
  accent: '#7ab5f0',
  fonts: { heading: { family: 'Geist Variable', urls: [] }, body: { family: 'Geist Variable', urls: [] } }
}

describe('applyTheme backgrounds', () => {
  it('sets the background-image CSS variables when the scene has one', async () => {
    const doc = document.implementation.createHTMLDocument('t')
    await applyTheme(doc, { ...base, bgImage: { url: 'data:bg', fit: 'cover', scrim: 0.4 } }, '/__talkie')
    const root = doc.documentElement.style
    expect(root.getPropertyValue('--talkie-bg-image')).toContain('data:bg')
    expect(root.getPropertyValue('--talkie-bg-fit')).toBe('cover')
    expect(root.getPropertyValue('--talkie-bg-scrim')).toBe('0.4')
    expect(doc.getElementById('__talkie-bg')).not.toBeNull()
  })

  it('injects the layer once even when applied twice', async () => {
    const doc = document.implementation.createHTMLDocument('t')
    const theme = { ...base, bgImage: { url: 'data:bg', fit: 'cover' as const, scrim: 0.4 } }
    await applyTheme(doc, theme, '/__talkie')
    await applyTheme(doc, theme, '/__talkie')
    expect(doc.querySelectorAll('#__talkie-bg')).toHaveLength(1)
  })

  it('leaves the variables empty when the scene has no background image', async () => {
    const doc = document.implementation.createHTMLDocument('t')
    await applyTheme(doc, base, '/__talkie')
    expect(doc.documentElement.style.getPropertyValue('--talkie-bg-image')).toBe('')
    expect(doc.getElementById('__talkie-bg')).toBeNull()
  })
})
