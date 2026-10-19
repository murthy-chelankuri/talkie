import { useEffect, useState } from 'react'
import { FolderGit2 } from 'lucide-react'
import { settingsClient } from '../api/projectClient'
import { Button } from './ui/Button'
import type { StudioInfo } from '../../../main/studio/describeStudio'

/**
 * Where the work lives, and how to carry it to another Mac: the Studio is one folder that can be
 * checked into git and cloned. Talkie runs no git itself — the person's own git, with their own
 * credentials, is the one that should be pushing their work somewhere.
 */
export function StudioSection(): JSX.Element {
  const [studio, setStudio] = useState<StudioInfo | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)

  useEffect(() => {
    void settingsClient.studio().then(setStudio).catch(() => setStudio(null))
  }, [])

  const where = studio?.shownPath ?? '~/Talkie/Studio'
  const start = `cd ${where}\ngit init\ngit add .\ngit commit -m "My Talkie Studio"`
  const elsewhere = `git clone <your repository> ${where}`

  return (
    <section aria-label="Studio" className="flex flex-col gap-3 rounded-xl bg-raised p-4">
      <span className="flex items-center gap-2">
        <FolderGit2 size={13} className="shrink-0 text-accent" aria-hidden="true" />
        <span className="text-[13px] font-medium text-text">Studio</span>
        <code className="truncate text-[11px] text-text-muted">{where}</code>
      </span>
      <p className="text-xs leading-relaxed text-text-muted">
        Your projects, themes and the settings that shape a video — voice, pace, captions and the click highlight — in one
        folder. Check it into git to carry on from another Mac. Your keys, the agent token and the Kokoro voice stay on this
        Mac and are never in it; nor are exports or the examples Talkie ships.
      </p>
      <p role="status" className="text-xs text-text-muted">
        {studio === null
          ? ''
          : studio.inGit
            ? studio.remote
              ? `In git, pushed to ${studio.remote}. Pull before you start and push when you stop — two Macs changing one project at once will conflict.`
              : 'In git, with nowhere to push to yet. Add a remote to share it.'
            : 'Not in git yet.'}
      </p>
      {studio && !studio.inGit && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-text-muted">To start, in Terminal:</span>
          <pre aria-label="Commands to put the Studio in git" className="select-text overflow-x-auto rounded-md bg-surface p-2 text-[11px] text-text">
            {start}
          </pre>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-text-muted">
          On another Mac, quit Talkie, move any Studio already there aside, then:
        </span>
        <pre aria-label="Command to clone the Studio" className="select-text overflow-x-auto rounded-md bg-surface p-2 text-[11px] text-text">
          {elsewhere}
        </pre>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void settingsClient.revealStudio().then(setRevealError).catch((err: unknown) => setRevealError(String(err)))}
        >
          Show in Finder
        </Button>
        {revealError && (
          <span role="alert" className="text-xs text-danger">
            Could not open the folder: {revealError}
          </span>
        )}
      </div>
    </section>
  )
}
