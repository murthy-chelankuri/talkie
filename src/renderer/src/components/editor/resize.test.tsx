import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ResizeHandle, useResizableWidth } from './ResizeHandle'

describe('a column that can be resized', () => {
  beforeEach(() => localStorage.clear())

  it('keeps its width between its limits, and remembers it', () => {
    const { result } = renderHook(() => useResizableWidth('w', 300, 260, 420))

    act(() => result.current[1](1000))
    expect(result.current[0]).toBe(420)
    act(() => result.current[1](10))
    expect(result.current[0]).toBe(260)
    expect(localStorage.getItem('w')).toBe('260')
    expect(renderHook(() => useResizableWidth('w', 300, 260, 420)).result.current[0]).toBe(260)
  })

  it('moves with the arrow keys, towards the stage widening it', async () => {
    function Column({ side }: { side: 'left' | 'right' }): JSX.Element {
      const [width, setWidth] = useState(300)
      return <ResizeHandle label="Resize" side={side} width={width} onWidth={setWidth} />
    }
    render(<Column side="left" />)
    screen.getByRole('separator', { name: 'Resize' }).focus()

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '310')
  })
})
