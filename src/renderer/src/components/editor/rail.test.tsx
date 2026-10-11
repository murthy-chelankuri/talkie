import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRailPanel } from './useRailPanel'
import { EditorRail } from './EditorRail'

const press = (key: string, meta = false): void => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: meta, bubbles: true }))
  })
}

describe('which editor panel is open', () => {
  beforeEach(() => localStorage.clear())

  it('starts with none, and with the one left open last time', () => {
    expect(renderHook(() => useRailPanel()).result.current.open).toBeNull()

    localStorage.setItem('talkie.railPanel', 'voice')
    expect(renderHook(() => useRailPanel()).result.current.open).toBe('voice')
  })

  it('opens one at a time, and closes the open one when it is asked for again', () => {
    const { result } = renderHook(() => useRailPanel())

    act(() => result.current.toggle('add'))
    expect(result.current.open).toBe('add')
    act(() => result.current.toggle('agent'))
    expect(result.current.open).toBe('agent')
    act(() => result.current.toggle('agent'))
    expect(result.current.open).toBeNull()
  })

  it('opens the panel asked for even when it is the one already open', () => {
    const { result } = renderHook(() => useRailPanel())

    act(() => result.current.show('add'))
    act(() => result.current.show('add'))
    expect(result.current.open).toBe('add')
  })

  it('remembers what is open', () => {
    const { result } = renderHook(() => useRailPanel())

    act(() => result.current.toggle('project'))
    expect(localStorage.getItem('talkie.railPanel')).toBe('project')
  })

  it('opens a panel with ⌘1 to ⌘4, and closes it with Esc', () => {
    const { result } = renderHook(() => useRailPanel())

    press('2', true)
    expect(result.current.open).toBe('add')
    press('Escape')
    expect(result.current.open).toBeNull()
  })

  it('leaves Esc to whatever is being typed in, or a dialog that is open', () => {
    const { result } = renderHook(() => useRailPanel())
    act(() => result.current.toggle('voice'))

    const field = document.createElement('textarea')
    document.body.append(field)
    field.focus()
    press('Escape')
    expect(result.current.open).toBe('voice')
    field.remove()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    press('Escape')
    expect(result.current.open).toBe('voice')
    dialog.remove()
  })

  it('starts closed when storage cannot be read', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(renderHook(() => useRailPanel()).result.current.open).toBeNull()
    read.mockRestore()
  })
})

describe('the editor rail', () => {
  it('names its four panels, with their shortcuts', () => {
    render(<EditorRail open={null} onToggle={() => {}} />)

    for (const [name, key] of [['Project', '⌘1'], ['Add', '⌘2'], ['Voice', '⌘3'], ['Agent', '⌘4']]) {
      expect(screen.getByRole('tab', { name })).toHaveAttribute('title', `${name} (${key})`)
    }
  })

  it('says the agent is still working while its panel is shut', () => {
    render(<EditorRail open={null} onToggle={() => {}} agentWorking />)

    expect(screen.getByRole('tab', { name: 'Agent' })).toHaveAccessibleDescription('Working')
  })

  it('asks for the panel clicked', async () => {
    const onToggle = vi.fn()
    render(<EditorRail open={null} onToggle={onToggle} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Voice' }))
    expect(onToggle).toHaveBeenCalledWith('voice')
  })
})
