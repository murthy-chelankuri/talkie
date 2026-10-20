import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FOLLOWS_DEFAULT, VoicePicker } from './VoicePicker'
import type { Voice } from '../api/projectClient'

const voice = (name: string, engine: Voice['engine'], locale = 'en_US'): Voice => ({ name, locale, sample: '', novelty: false, engine })

const BOTH = [voice('Samantha', 'system'), voice('Daniel', 'system', 'en_GB'), voice('af_heart', 'kokoro'), voice('bm_george', 'kokoro', 'en_GB')]

describe('the voice picker', () => {
  it('offers both engines’ voices, each under its engine', () => {
    render(<VoicePicker ariaLabel="Voice for this project" value="af_heart" voices={BOTH} onChange={() => undefined} />)

    const picker = screen.getByRole('combobox', { name: 'Voice for this project' })
    const groups = within(picker).getAllByRole('group').map((group) => group.getAttribute('label'))
    expect(groups.some((label) => label?.startsWith('Kokoro · '))).toBe(true)
    expect(groups.some((label) => label?.startsWith('macOS · '))).toBe(true)
  })

  it('moves a project from a Kokoro voice to one of the Mac’s', async () => {
    const onChange = vi.fn()
    render(<VoicePicker ariaLabel="Voice for this project" value="af_heart" voices={BOTH} onChange={onChange} />)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Voice for this project' }), 'Samantha')

    expect(onChange).toHaveBeenCalledWith('Samantha')
  })

  it('shows a voice this Mac cannot read as what it is, rather than as the first in the list', () => {
    // A Studio cloned onto a Mac without Kokoro downloaded: its project is still in af_heart.
    render(
      <VoicePicker
        ariaLabel="Voice for this project"
        value="af_heart"
        voices={[voice('Samantha', 'system')]}
        onChange={() => undefined}
        defaultOption={{ label: 'App default' }}
      />
    )

    const picker = screen.getByRole('combobox', { name: 'Voice for this project' }) as HTMLSelectElement
    expect(picker.value).toBe('af_heart')
    expect(screen.getByRole('option', { name: 'af_heart (not ready on this Mac)' })).toBeInTheDocument()
  })

  it('lists the one engine’s voices by language alone, as Settings does', () => {
    render(<VoicePicker ariaLabel="Default voice" value={FOLLOWS_DEFAULT} voices={[{ name: 'Samantha', locale: 'en_US', sample: '', novelty: false }]} onChange={() => undefined} />)

    const label = within(screen.getByRole('combobox', { name: 'Default voice' })).getByRole('group').getAttribute('label')
    expect(label).not.toContain('·')
  })
})
