import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {}, shell: {} }))
const { asDoctorCheck, issueTitle } = await import('./diagnosticsHandlers')

describe('a report made from the window', () => {
  it('titles the issue with the first line of what went wrong', () => {
    expect(issueTitle('Narration fails over MCP\nIt says exit code 1')).toBe('Problem: Narration fails over MCP')
    expect(issueTitle('   ')).toBe('Problem report')
    expect(issueTitle('x'.repeat(120))).toHaveLength(9 + 78)
  })

  it('counts a missing optional part as a note, not a failure', () => {
    expect(asDoctorCheck({ id: 'decks', label: 'PowerPoint import', purpose: 'Import a .pptx', ready: false, fix: 'Install LibreOffice', required: false })).toEqual({
      id: 'decks',
      label: 'PowerPoint import',
      ok: null,
      detail: 'Import a .pptx',
      fix: 'Install LibreOffice'
    })
  })
})
