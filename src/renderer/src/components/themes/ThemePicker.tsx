import { useEffect, useState } from 'react'
import { themeClient, type Theme } from '../../api/projectClient'
import { isBuiltinThemeId } from '../../../../main/themes/builtinThemes'

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
        className="rounded-md bg-raised px-2 py-1.5 text-[13px] text-text"
      >
        <option value="">Talkie’s own look</option>
        {[
          { label: 'Your themes', list: themes.filter((theme) => !isBuiltinThemeId(theme.id)) },
          { label: 'Built into Talkie', list: themes.filter((theme) => isBuiltinThemeId(theme.id)) }
        ]
          .filter(({ list }) => list.length > 0)
          .map(({ label, list }) => (
            <optgroup key={label} label={label}>
              {list.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
      {themes.length > 0 && themes.every((theme) => isBuiltinThemeId(theme.id)) && (
        <span className="text-[11px] text-text-muted">Make one for a company in Settings → Themes.</span>
      )}
    </div>
  )
}
