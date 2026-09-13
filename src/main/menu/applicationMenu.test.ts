import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'

vi.mock('electron', () => ({
  app: { name: 'Talkie' },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  shell: { openExternal: vi.fn() }
}))

const { buildMenuTemplate, INITIAL_MENU_STATE } = await import('./applicationMenu')

type Item = MenuItemConstructorOptions

const menu = (template: Item[], label: string): Item[] =>
  ((template.find((m) => m.label === label)?.submenu ?? []) as Item[])

const labels = (items: Item[]): string[] =>
  items.map((i) => i.label ?? i.role ?? (i.type === 'separator' ? '—' : '?')).filter(Boolean) as string[]

const find = (template: Item[], menuLabel: string, itemLabel: string): Item | undefined =>
  menu(template, menuLabel).find((i) => i.label === itemLabel)

describe('the application menu', () => {
  const open = { projectOpen: true, canUndo: true, canRedo: true }

  it('gives File the things you actually do with a project', () => {
    const template = buildMenuTemplate(open, () => {}, 'darwin')

    // The complaint this answers: File held only Close Window.
    expect(labels(menu(template, 'File'))).toEqual(
      expect.arrayContaining([
        'New Project…',
        'Open Project…',
        'Record a Session…',
        'Add a Scene…',
        'Import an Image…',
        'Import a Slide Deck…',
        'Export Video…'
      ])
    )
  })

  it('greys out what cannot be done without a project open', () => {
    const template = buildMenuTemplate(INITIAL_MENU_STATE, () => {}, 'darwin')

    expect(find(template, 'File', 'Export Video…')?.enabled).toBe(false)
    expect(find(template, 'File', 'Import an Image…')?.enabled).toBe(false)
    // Starting or opening a project is exactly what you can still do there.
    expect(find(template, 'File', 'New Project…')?.enabled).toBe(true)
    expect(find(template, 'File', 'Open Project…')?.enabled).toBe(true)
  })

  it('follows whether there is anything to undo', () => {
    const nothing = buildMenuTemplate(INITIAL_MENU_STATE, () => {}, 'darwin')
    const something = buildMenuTemplate(open, () => {}, 'darwin')

    expect(find(nothing, 'Edit', 'Undo')?.enabled).toBe(false)
    expect(find(something, 'Edit', 'Undo')?.enabled).toBe(true)
  })

  /**
   * Undo has to reach the window rather than use Electron's role, because the window is the only
   * thing that knows whether the cursor is in a text field.
   */
  it('routes Undo to the window instead of using the built-in role', () => {
    const sent: string[] = []
    const template = buildMenuTemplate(open, (action) => sent.push(action), 'darwin')
    const undo = find(template, 'Edit', 'Undo')

    expect(undo?.role).toBeUndefined()
    expect(undo?.accelerator).toBe('CmdOrCtrl+Z')
    ;(undo?.click as () => void)()
    expect(sent).toEqual(['undo'])
  })

  it('keeps the ordinary clipboard items as roles, which is what they should be', () => {
    const template = buildMenuTemplate(open, () => {}, 'darwin')
    const roles = menu(template, 'Edit').map((i) => i.role)

    expect(roles).toEqual(expect.arrayContaining(['cut', 'copy', 'paste', 'selectAll']))
  })

  it('sends the action a menu item names', () => {
    const sent: string[] = []
    const template = buildMenuTemplate(open, (action) => sent.push(action), 'darwin')

    ;(find(template, 'File', 'Export Video…')?.click as () => void)()
    ;(find(template, 'Project', 'Speak All Clips')?.click as () => void)()

    expect(sent).toEqual(['export-video', 'speak-all'])
  })

  it('puts Settings in the app menu on macOS and under File elsewhere', () => {
    const mac = buildMenuTemplate(open, () => {}, 'darwin')
    const win = buildMenuTemplate(open, () => {}, 'win32')

    expect(labels(menu(mac, 'Talkie'))).toContain('Settings…')
    expect(labels(menu(mac, 'File'))).not.toContain('Settings…')
    expect(labels(menu(win, 'File'))).toContain('Settings…')
    // No app menu exists off macOS, so quitting belongs to File there.
    expect(menu(win, 'Talkie')).toHaveLength(0)
    expect(menu(win, 'File').some((i) => i.role === 'quit')).toBe(true)
  })

  it('offers help that goes somewhere', () => {
    const template = buildMenuTemplate(open, () => {}, 'darwin')

    expect(labels(menu(template, 'Help'))).toEqual(
      expect.arrayContaining(['Licences', 'Talkie on GitHub', 'Report an Issue'])
    )
  })
})
