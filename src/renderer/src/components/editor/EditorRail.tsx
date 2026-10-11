import { AudioLines, FolderOpen, Plus, Sparkles } from 'lucide-react'
import { Rail } from '../ui/Rail'
import type { RailPanelId } from './useRailPanel'

const ITEMS = [
  { id: 'project', label: 'Project', icon: <FolderOpen size={17} />, shortcut: '⌘1' },
  { id: 'add', label: 'Add', icon: <Plus size={18} />, shortcut: '⌘2' },
  { id: 'voice', label: 'Voice', icon: <AudioLines size={17} />, shortcut: '⌘3' },
  { id: 'agent', label: 'Agent', icon: <Sparkles size={17} />, shortcut: '⌘4' }
]

/** The editor's rail. The agent can be working with its panel shut, so the rail says so. */
export function EditorRail({
  open,
  onToggle,
  agentWorking = false
}: {
  open: RailPanelId | null
  onToggle: (id: RailPanelId) => void
  agentWorking?: boolean
}): JSX.Element {
  return (
    <Rail
      label="Editor panels"
      items={ITEMS.map((item) => (item.id === 'agent' && agentWorking && open !== 'agent' ? { ...item, busy: 'Working' } : item))}
      selected={open}
      onSelect={(id) => onToggle(id as RailPanelId)}
    />
  )
}
