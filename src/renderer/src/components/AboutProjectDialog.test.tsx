import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AboutProjectDialog } from './AboutProjectDialog'
import { EMPTY_CONTEXT } from '../../../main/project/projectContext'

describe('telling the voice how a name is said', () => {
  it('saves a word with the way it should be heard', async () => {
    const onSave = vi.fn()
    render(<AboutProjectDialog projectName="Demo" context={EMPTY_CONTEXT} onSave={onSave} onClose={() => {}} />)

    await userEvent.click(screen.getByText('Add a word the voice says wrong'))
    await userEvent.type(screen.getByLabelText('Written 1'), 'SecOps')
    await userEvent.type(screen.getByLabelText('Said as 1'), 'Seck-ops')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ pronunciations: [{ written: 'SecOps', spoken: 'Seck-ops' }] })
    )
  })

  it('drops a row left half filled, rather than storing a word with no way to say it', async () => {
    const onSave = vi.fn()
    render(<AboutProjectDialog projectName="Demo" context={EMPTY_CONTEXT} onSave={onSave} onClose={() => {}} />)

    await userEvent.click(screen.getByText('Add a word the voice says wrong'))
    await userEvent.type(screen.getByLabelText('Written 1'), 'SecOps')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ pronunciations: [] }))
  })

  it('shows the ones already saved, so they can be corrected', () => {
    const context = { ...EMPTY_CONTEXT, pronunciations: [{ written: 'ITOM', spoken: 'eye tom' }] }
    render(<AboutProjectDialog projectName="Demo" context={context} onSave={() => {}} onClose={() => {}} />)

    expect(screen.getByLabelText('Written 1')).toHaveValue('ITOM')
    expect(screen.getByLabelText('Said as 1')).toHaveValue('eye tom')
  })
})
