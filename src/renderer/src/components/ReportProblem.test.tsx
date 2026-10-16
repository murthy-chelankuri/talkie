import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportProblem } from './ReportProblem'
import { settingsClient } from '../api/projectClient'

vi.mock('../api/projectClient', () => ({ settingsClient: { reportProblem: vi.fn() } }))

describe('reporting a problem', () => {
  it('sends what went wrong in the person’s words, and says where the report was saved', async () => {
    vi.mocked(settingsClient.reportProblem).mockResolvedValue({ status: 'saved', path: '/Users/x/Desktop/Talkie report.zip' })
    render(<ReportProblem />)

    await userEvent.type(screen.getByRole('textbox', { name: 'What went wrong' }), 'Narration fails over MCP')
    await userEvent.click(screen.getByRole('button', { name: 'Save report and open GitHub' }))

    expect(settingsClient.reportProblem).toHaveBeenCalledWith('Narration fails over MCP')
    expect(await screen.findByRole('status')).toHaveTextContent('Saved to /Users/x/Desktop/Talkie report.zip')
  })

  it('says, before anything is made, that nothing from a project goes in and nothing is sent', () => {
    render(<ReportProblem />)

    const card = screen.getByRole('region', { name: 'Report a problem' })
    expect(card).toHaveTextContent('Nothing from your projects goes in')
    expect(card).toHaveTextContent('Nothing is sent until you post it')
  })

  it('goes back to how it was when the save is cancelled', async () => {
    vi.mocked(settingsClient.reportProblem).mockResolvedValue({ status: 'cancelled' })
    render(<ReportProblem />)

    await userEvent.click(screen.getByRole('button', { name: 'Save report and open GitHub' }))

    expect(screen.getByRole('button', { name: 'Save report and open GitHub' })).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
