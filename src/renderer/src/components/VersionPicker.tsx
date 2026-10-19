import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { activeVersion, type Versions } from '../../../main/project/versions'
import { Button } from './ui/Button'
import { cn } from '../lib/cn'

interface VersionPickerProps {
  versions: Versions
  onChoose: (versionId: string) => void
  onCreate: (name: string) => void
  onRename: (versionId: string, name: string) => void
  onDelete: (versionId: string) => void
}

/**
 * Which cut of the video is being worked on — the full walkthrough, a two-minute one, one for
 * sales — and the way to make another. See versions.ts.
 *
 * It sits on the timeline because that is where scenes are left in or out: switching version
 * changes which of them are dimmed there, what the player plays, and what Export writes. A new
 * version starts as a copy of the one on screen, since a shorter cut is nearly always made by
 * taking things out of a longer one.
 */
export function VersionPicker({ versions, onChoose, onCreate, onRename, onDelete }: VersionPickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  // Naming a new version, or renaming the current one: the field shown in place of the list.
  const [naming, setNaming] = useState<null | { mode: 'create' | 'rename'; value: string }>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const current = activeVersion(versions)
  const counted = versions.versions.length

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function close(): void {
    setOpen(false)
    setNaming(null)
  }

  function submitName(): void {
    if (!naming || !naming.value.trim()) return
    if (naming.mode === 'create') onCreate(naming.value.trim())
    else onRename(current.id, naming.value.trim())
    close()
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Version: ${current.name}`}
        title="Which cut of the video you are working on. Scenes left out of it are dimmed, and skipped when it plays and exports."
        onClick={() => (open ? close() : setOpen(true))}
        className="max-w-56 gap-1.5 text-text"
      >
        <Layers size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
        <span className="truncate">{current.name}</span>
        <ChevronsUpDown size={13} className="shrink-0 text-text-muted" aria-hidden="true" />
      </Button>

      {open && (
        <div role="menu" aria-label="Versions" className="absolute left-0 top-[calc(100%+6px)] z-50 w-68 rounded-xl bg-raised p-1.5 shadow-xl">
          {naming ? (
            <form
              className="flex flex-col gap-2 p-1.5"
              onSubmit={(event) => {
                event.preventDefault()
                submitName()
              }}
            >
              <label className="flex flex-col gap-1 text-[12px] text-text-muted">
                {naming.mode === 'create' ? `A new version, starting from ${current.name}` : 'Rename this version'}
                <input
                  autoFocus
                  aria-label="Version name"
                  value={naming.value}
                  placeholder="2-minute cut"
                  onChange={(event) => setNaming({ ...naming, value: event.target.value })}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-text outline-hidden focus:ring-2 focus:ring-accent/35"
                />
              </label>
              <div className="flex justify-end gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => setNaming(null)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={!naming.value.trim()}>
                  {naming.mode === 'create' ? 'Make version' : 'Rename'}
                </Button>
              </div>
            </form>
          ) : (
            <>
              {versions.versions.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={version.id === current.id}
                  onClick={() => {
                    if (version.id !== current.id) onChoose(version.id)
                    close()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md border-0 px-2.5 py-1.5 text-left text-[13px] text-text',
                    version.id === current.id ? 'bg-surface-hover' : 'bg-transparent hover:bg-surface-hover'
                  )}
                >
                  <span className="w-3.5 shrink-0">{version.id === current.id && <Check size={13} className="text-accent" />}</span>
                  <span className="min-w-0 flex-1 truncate">{version.name}</span>
                  <span className="shrink-0 text-[11px] text-text-muted">
                    {version.leftOut.length === 0 ? 'every scene' : `${version.leftOut.length} left out`}
                  </span>
                </button>
              ))}
              <div className="my-1 h-px bg-border" />
              <MenuAction icon={<Plus size={13} />} onClick={() => setNaming({ mode: 'create', value: '' })}>
                New version…
              </MenuAction>
              <MenuAction icon={<Pencil size={13} />} onClick={() => setNaming({ mode: 'rename', value: current.name })}>
                Rename {current.name}…
              </MenuAction>
              <MenuAction
                icon={<Trash2 size={13} />}
                disabled={counted < 2}
                title={counted < 2 ? 'A project always has at least one version' : undefined}
                onClick={() => {
                  onDelete(current.id)
                  close()
                }}
              >
                Delete {current.name}
              </MenuAction>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MenuAction({
  icon,
  children,
  disabled,
  title,
  onClick
}: {
  icon: JSX.Element
  children: React.ReactNode
  disabled?: boolean
  title?: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-[13px] text-text hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
    >
      <span className="w-3.5 shrink-0 text-text-muted">{icon}</span>
      {children}
    </button>
  )
}
