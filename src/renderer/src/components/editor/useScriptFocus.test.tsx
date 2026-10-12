import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useScriptFocus } from './useScriptFocus'

function press(key: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }))
  })
}

describe('giving the script the whole window', () => {
  it('turns on and off from the same button', () => {
    const { result } = renderHook(() => useScriptFocus(true))
    act(() => result.current.toggle())
    expect(result.current.focused).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.focused).toBe(false)
  })

  it('gives the video back on Esc', () => {
    const { result } = renderHook(() => useScriptFocus(true))
    act(() => result.current.toggle())
    press('Escape')
    expect(result.current.focused).toBe(false)
  })

  it('leaves Esc to a dialog that is open over it', () => {
    const { result } = renderHook(() => useScriptFocus(true))
    act(() => result.current.toggle())
    const dialog = document.body.appendChild(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')
    press('Escape')
    expect(result.current.focused).toBe(true)
    dialog.remove()
  })

  it('never takes the window for the timeline, which is arranged against the picture', () => {
    const { result, rerender } = renderHook(({ shown }) => useScriptFocus(shown), { initialProps: { shown: true } })
    act(() => result.current.toggle())
    rerender({ shown: false })
    expect(result.current.focused).toBe(false)
  })
})
