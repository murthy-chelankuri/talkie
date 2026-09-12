import { useEffect, useState } from 'react'
import { CircleCheck, FolderOpen, Play, X } from 'lucide-react'
import { renderClient, type ExportedFile } from '../api/projectClient'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'

/**
 * What the user gets at the end of the whole process.
 *
 * A raw path in muted grey is the least this moment could be: it is the file they came to make,
 * and it cannot be opened or found from there without copying the text into somewhere else. The
 * name, the size and the two things anyone would want to do with it are here instead.
 */
export function ExportedCard({ path, onDismiss }: { path: string; onDismiss: () => void }): JSX.Element | null {
  const [file, setFile] = useState<ExportedFile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    renderClient.describe(path).then(setFile)
  }, [path])

  if (!file) return null

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-success/40 bg-success/[0.06] p-3">
      <div className="flex items-start gap-2">
        <CircleCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] font-medium text-text">Video exported</span>
          <span className="truncate text-[11px] text-text-muted" title={file.path}>
            {file.name}
          </span>
          <span className="text-[11px] text-text-muted">{formatBytes(file.bytes)}</span>
        </div>
        <IconButton aria-label="Dismiss" onClick={onDismiss} className="-mr-1 -mt-1 h-6 w-6">
          <X size={13} />
        </IconButton>
      </div>

      <div className="flex flex-col gap-1.5">
        <Button
          size="sm"
          onClick={async () => setError(await renderClient.open(file.path))}
        >
          <Play size={13} />
          Play
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => setError(await renderClient.reveal(file.path))}
        >
          <FolderOpen size={13} />
          Show in Finder
        </Button>
      </div>

      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  )
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`
  return mb < 100 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`
}
