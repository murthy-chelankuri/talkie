import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, Menu: { buildFromTemplate: vi.fn() } }))

const { buildEditContextMenu } = await import('./editContextMenu')

type Params = Parameters<typeof buildEditContextMenu>[0]

function params(overrides: Partial<Params> = {}): Params {
  return {
    isEditable: true,
    selectionText: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: { canCut: true, canCopy: true, canPaste: true },
    ...overrides
  } as Params
}

function roles(template: ReturnType<typeof buildEditContextMenu>): string[] {
  return template.map((item) => item.role ?? item.label ?? item.type ?? '').filter(Boolean) as string[]
}

describe('the menu on a right-click', () => {
  it('offers the system’s own text features over a selection', () => {
    // This is the whole point: Writing Tools lives in the Services menu, so without this there is
    // no route to Rewrite or Proofread from the narration box.
    const template = buildEditContextMenu(params({ selectionText: 'Some narration.' }), 'darwin')

    expect(roles(template)).toContain('services')
  })

  it('leaves Services out when nothing is selected', () => {
    // An empty submenu reads as a broken menu rather than an unavailable feature.
    expect(roles(buildEditContextMenu(params(), 'darwin'))).not.toContain('services')
  })

  it('leaves Services out where the system has none', () => {
    const template = buildEditContextMenu(params({ selectionText: 'Some narration.' }), 'win32')

    expect(roles(template)).not.toContain('services')
  })

  it('offers the usual editing on a text field', () => {
    expect(roles(buildEditContextMenu(params(), 'darwin'))).toEqual(
      expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
    )
  })

  it('follows what the field will actually accept', () => {
    const template = buildEditContextMenu(
      params({ editFlags: { canCut: false, canCopy: false, canPaste: true } as never }),
      'darwin'
    )

    expect(template.find((item) => item.role === 'cut')?.enabled).toBe(false)
    expect(template.find((item) => item.role === 'paste')?.enabled).toBe(true)
  })

  it('puts corrections first, because that is usually why the menu was opened', () => {
    const template = buildEditContextMenu(
      params({ misspelledWord: 'naration', dictionarySuggestions: ['narration', 'nation'] }),
      'darwin'
    )

    expect(template[0].label).toBe('narration')
    expect(template[1].label).toBe('nation')
  })

  it('does not offer more corrections than anyone reads', () => {
    const template = buildEditContextMenu(
      params({
        misspelledWord: 'x',
        dictionarySuggestions: ['a', 'b', 'c', 'd', 'e', 'f', 'g']
      }),
      'darwin'
    )

    expect(template.filter((item) => item.label).length).toBe(5)
  })

  it('offers only copying where the text cannot be changed', () => {
    const template = buildEditContextMenu(
      params({ isEditable: false, selectionText: 'Read only words.' }),
      'darwin'
    )

    expect(roles(template)).toContain('copy')
    expect(roles(template)).not.toContain('paste')
    // Still worth offering the system features: proofreading does not need a writable field.
    expect(roles(template)).toContain('services')
  })

  it('shows nothing at all when there is nothing to act on', () => {
    // A menu that appears, says nothing and has to be dismissed is worse than no menu.
    expect(buildEditContextMenu(params({ isEditable: false }), 'darwin')).toEqual([])
  })
})
