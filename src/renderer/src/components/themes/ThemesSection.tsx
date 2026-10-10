import { useCallback, useEffect, useState } from 'react'
import { Palette, Plus, Sparkles } from 'lucide-react'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { ThemeEditor } from './ThemeEditor'
import { CreateThemeDialog } from './CreateThemeDialog'
import { defaultThemeDraft } from '../../../../main/themes/schema'
import { themeClient, type Theme, type ThemeDraft } from '../../api/projectClient'

type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; draft: ThemeDraft; themeId?: string; stagingDir?: string }

/**
 * The theme library: what a company's videos look like, kept once and chosen per project.
 */
export function ThemesSection(): JSX.Element {
  const [themes, setThemes] = useState<Theme[] | null>(null)
  const [view, setView] = useState<View>({ kind: 'list' })

  const reload = useCallback(async () => setThemes(await themeClient.list()), [])
  useEffect(() => {
    void reload()
  }, [reload])

  const backToList = async (): Promise<void> => {
    setView({ kind: 'list' })
    await reload()
  }

  if (view.kind === 'create') {
    return (
      <CreateThemeDialog
        onCancel={() => setView({ kind: 'list' })}
        onCreated={({ draft, stagingDir }) => setView({ kind: 'edit', draft, stagingDir })}
      />
    )
  }
  if (view.kind === 'edit') {
    return <ThemeEditor initial={view.draft} themeId={view.themeId} stagingDir={view.stagingDir} onDone={backToList} />
  }

  // A hand-made theme is saved at once, from Talkie's own look, so its logo and fonts have
  // somewhere to go from the first file added.
  async function newTheme(): Promise<void> {
    const theme = await themeClient.create(defaultThemeDraft('Untitled theme'))
    setView({ kind: 'edit', draft: theme, themeId: theme.id })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-text-muted">
        A theme is a company&rsquo;s look — colours, type, logo, and the cards that open and close a video. Make
        one by hand or from a website, then choose it for a project in About this project.
      </p>

      <div className="flex gap-2">
        <Button onClick={() => setView({ kind: 'create' })}>
          <Sparkles size={14} />
          Create with AI
        </Button>
        <Button variant="ghost" onClick={() => void newTheme()}>
          <Plus size={14} />
          New theme
        </Button>
      </div>

      {themes === null ? (
        <Spinner size="md" label="Loading themes" />
      ) : themes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <Palette size={20} className="text-text-muted" />
          <p className="text-[13px] text-text">No themes yet</p>
          <p className="max-w-sm text-[12px] leading-relaxed text-text-muted">
            Give Talkie a company&rsquo;s website and it will make one from the real brand.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {themes.map((theme) => (
            <li key={theme.id}>
              <button
                type="button"
                onClick={() => setView({ kind: 'edit', draft: theme, themeId: theme.id })}
                className="flex w-full flex-col gap-2 rounded-lg border border-border bg-bg p-3 text-left transition-colors hover:border-text-muted/40"
              >
                <span className="flex h-10 overflow-hidden rounded-md" aria-hidden="true">
                  {(['brand', 'light', 'dark'] as const).map((id) => (
                    <span
                      key={id}
                      className="flex flex-1 items-center justify-center text-[13px]"
                      style={{ background: theme.variants[id].background, color: theme.variants[id].heading }}
                    >
                      <span style={{ borderBottom: `2px solid ${theme.variants[id].accent}` }}>Aa</span>
                    </span>
                  ))}
                </span>
                <span className="flex flex-col">
                  <span className="text-[13px] font-medium text-text">{theme.name}</span>
                  <span className="truncate text-[11px] text-text-muted">
                    {[theme.company, theme.fonts.heading.family].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
