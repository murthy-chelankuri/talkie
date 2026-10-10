import { useEffect, useState } from 'react'
import { themeClient, type Theme } from '../../api/projectClient'

/**
 * Which theme this project's video follows.
 *
 * Applied the moment it is chosen rather than with the dialog's Save: it changes the video, not
 * the words, and the cards it adds the first time should be on the timeline when the dialog closes.
 */
export function ThemePicker({
  themeId,
  onChange
}: {
  themeId?: string
  onChange: (themeId: string | null) => Promise<void> | void
}): JSX.Element {
  const [themes, setThemes] = useState<Theme[]>([])
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    void themeClient.list().then(setThemes)
  }, [])

  return (
    <div className="flex flex-col gap-1.5">
      <select
        aria-label="Theme"
        value={themeId ?? ''}
        disabled={applying}
        onChange={async (event) => {
          setApplying(true)
          try {
            await onChange(event.target.value || null)
          } finally {
            setApplying(false)
          }
        }}
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-text"
      >
        <option value="">Talkie’s own look</option>
        {themes.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.name}
          </option>
        ))}
      </select>
      {themes.length === 0 && (
        <span className="text-[11px] text-text-muted">Make a theme in Settings → Themes, then choose it here.</span>
      )}
    </div>
  )
}
