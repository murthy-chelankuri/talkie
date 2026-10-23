import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FOLLOWS_DEFAULT, VoicePicker } from './VoicePicker'
import type { Voice } from '../api/projectClient'

const voice = (name: string, locale = 'en_US'): Voice => ({ name, locale, sample: '', novelty: false })

const VOICES = [voice('af_heart'), voice('af_bella'), voice('bm_george', 'en_GB'), voice('bf_emma', 'en_GB')]

describe('the voice picker', () => {
  it('lists Kokoro’s voices by language, with no engine to name when there is only one', () => {
    render(<VoicePicker ariaLabel="Voice for this project" value="af_heart" voices={VOICES} onChange={() => undefined} />)

    const picker = screen.getByRole('combobox', { name: 'Voice for this project' })
    const groups = within(picker).getAllByRole('group').map((group) => group.getAttribute('label'))
    // Grouped by language, and with a single engine no "Kokoro · " prefix cluttering every group.
    expect(groups.every((label) => !label?.includes('·'))).toBe(true)
    expect(groups.length).toBeGreaterThan(1)
  })

  it('moves a project to another voice', async () => {
    const onChange = vi.fn()
    render(<VoicePicker ariaLabel="Voice for this project" value="af_heart" voices={VOICES} onChange={onChange} />)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Voice for this project' }), 'bm_george')

    expect(onChange).toHaveBeenCalledWith('bm_george')
  })

  it('shows a voice that is not ready as what it is, rather than as the first in the list', () => {
    // A Studio cloned onto a Mac without Kokoro downloaded: its project is still in af_heart.
    render(
      <VoicePicker
        ariaLabel="Voice for this project"
        value="af_heart"
        voices={[voice('bm_george', 'en_GB')]}
        onChange={() => undefined}
        defaultOption={{ label: 'App default' }}
      />
    )

    const picker = screen.getByRole('combobox', { name: 'Voice for this project' }) as HTMLSelectElement
    expect(picker.value).toBe('af_heart')
    expect(screen.getByRole('option', { name: 'af_heart (not ready)' })).toBeInTheDocument()
  })
})
