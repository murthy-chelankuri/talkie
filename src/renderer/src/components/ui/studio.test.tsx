import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from 'lucide-react'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { ButtonGroup } from './ButtonGroup'
import { Segmented } from './Segmented'
import { Rail } from './Rail'
import { SidePanel } from './SidePanel'

describe('Studio buttons', () => {
  it('fills the main action with the accent, in white', () => {
    render(<Button>Export</Button>)
    expect(screen.getByRole('button', { name: 'Export' })).toHaveClass('bg-accent-fill', 'text-on-accent')
  })

  it('tints an AI action with the accent rather than filling it', () => {
    render(<Button variant="soft">Write the words</Button>)
    expect(screen.getByRole('button', { name: 'Write the words' })).toHaveClass('bg-accent-soft')
  })

  it('draws an icon button without an outline', () => {
    render(<IconButton aria-label="Settings"><Settings size={14} /></IconButton>)
    expect(screen.getByRole('button', { name: 'Settings' }).className).not.toMatch(/\bborder\b/)
  })

  it('groups buttons under one name', () => {
    render(<ButtonGroup aria-label="Edit the timeline"><IconButton aria-label="Undo">u</IconButton></ButtonGroup>)
    expect(screen.getByRole('group', { name: 'Edit the timeline' })).toContainElement(screen.getByRole('button', { name: 'Undo' }))
  })
})

describe('a segmented choice', () => {
  const options = [{ id: 'brand', label: 'Brand' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }] as const

  it('says which one is chosen, and chooses on click', async () => {
    const onChange = vi.fn()
    render(<Segmented label="Look" value="dark" options={[...options]} onChange={onChange} />)

    expect(screen.getByRole('radiogroup', { name: 'Look' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(onChange).toHaveBeenCalledWith('light')
  })

  it('moves with the arrow keys', async () => {
    const onChange = vi.fn()
    render(<Segmented label="Look" value="brand" options={[...options]} onChange={onChange} />)

    screen.getByRole('radio', { name: 'Brand' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith('light')
  })
})

describe('the rail', () => {
  const items = [
    { id: 'project', label: 'Project', icon: <span />, shortcut: '⌘1' },
    { id: 'add', label: 'Add', icon: <span />, shortcut: '⌘2' }
  ]

  it('is a vertical list of tabs, one per panel, with the open one selected', () => {
    render(<Rail label="Panels" items={items} selected="add" onSelect={() => {}} />)

    expect(screen.getByRole('tablist', { name: 'Panels' })).toHaveAttribute('aria-orientation', 'vertical')
    expect(screen.getByRole('tab', { name: 'Add' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Project' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Project' })).toHaveAttribute('title', 'Project (⌘1)')
  })

  it('says which panel was asked for', async () => {
    const onSelect = vi.fn()
    render(<Rail label="Panels" items={items} selected={null} onSelect={onSelect} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Project' }))
    expect(onSelect).toHaveBeenCalledWith('project')
  })
})

describe('a side panel', () => {
  it('is a region named by its title, with a way to close it', async () => {
    const onClose = vi.fn()
    render(<SidePanel title="Voice" onClose={onClose}><p>inside</p></SidePanel>)

    expect(screen.getByRole('region', { name: 'Voice' })).toHaveTextContent('inside')
    await userEvent.click(screen.getByRole('button', { name: 'Close Voice' }))
    expect(onClose).toHaveBeenCalled()
  })
})
