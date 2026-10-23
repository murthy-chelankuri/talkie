import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { renderThemeFrom } from './toRenderTheme'
import { ThemeDraftSchema } from './schema'

function themeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'render-theme-'))
  mkdirSync(join(dir, 'logos'), { recursive: true })
  mkdirSync(join(dir, 'backgrounds'), { recursive: true })
  return dir
}

const base = {
  name: 'Acme',
  variants: {
    brand: { background: '#2e2310', heading: '#fbf3e2', body: '#e0cfa8', accent: '#e9b949' },
    light: { background: '#f7f3ea', heading: '#1c1a16', body: '#514b41', accent: '#1a5fb4' },
    dark: { background: '#171b22', heading: '#f4f6f9', body: '#c9cedb', accent: '#7ab5f0' }
  },
  fonts: {
    heading: { family: 'Newsreader Variable', source: 'builtin' as const },
    body: { family: 'Geist Variable', source: 'builtin' as const }
  }
}

describe('renderThemeFrom with v2 assets', () => {
  it('reads each logo slot into its own data URL', () => {
    const dir = themeDir()
    writeFileSync(join(dir, 'logos/light.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    writeFileSync(join(dir, 'logos/dark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const draft = ThemeDraftSchema.parse({ ...base, logo: { light: { file: 'logos/light.svg' }, dark: { file: 'logos/dark.svg' } } })
    const rendered = renderThemeFrom(draft, dir)
    expect(rendered.logo?.light?.startsWith('data:image/svg+xml')).toBe(true)
    expect(rendered.logo?.dark?.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('reads a background slot into a data URL with its fit and scrim', () => {
    const dir = themeDir()
    writeFileSync(join(dir, 'backgrounds/card-dark.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const draft = ThemeDraftSchema.parse({ ...base, backgrounds: { card: { dark: { file: 'backgrounds/card-dark.png', fit: 'cover', scrim: 0.4 } } } })
    const rendered = renderThemeFrom(draft, dir)
    expect(rendered.backgrounds?.card?.dark?.url.startsWith('data:image/png')).toBe(true)
    expect(rendered.backgrounds?.card?.dark?.scrim).toBe(0.4)
    expect(rendered.backgrounds?.card?.dark?.fit).toBe('cover')
  })

  it('drops a background over the inline ceiling and warns rather than shrinking it', () => {
    const dir = themeDir()
    writeFileSync(join(dir, 'backgrounds/content-light.png'), Buffer.alloc(13 * 1024 * 1024))
    const draft = ThemeDraftSchema.parse({ ...base, backgrounds: { content: { light: { file: 'backgrounds/content-light.png' } } } })
    const rendered = renderThemeFrom(draft, dir)
    expect(rendered.backgrounds?.content?.light).toBeUndefined()
    expect(rendered.warnings?.some((w) => /content-light/.test(w) || /too large/i.test(w))).toBe(true)
  })

  it('changes the stamp when a background is added', () => {
    const dir = themeDir()
    const bare = ThemeDraftSchema.parse(base)
    writeFileSync(join(dir, 'backgrounds/card-dark.png'), Buffer.from([0x89]))
    const withBg = ThemeDraftSchema.parse({ ...base, backgrounds: { card: { dark: { file: 'backgrounds/card-dark.png' } } } })
    expect(renderThemeFrom(bare, dir).stamp).not.toBe(renderThemeFrom(withBg, dir).stamp)
  })
})
