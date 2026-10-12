import { Download } from 'lucide-react'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { ErrorBanner } from '../ui/ErrorBanner'
import { ExportedCard } from '../ExportedCard'

/**
 * Export, in the top bar: it is the last step of every project and the one thing that leaves the
 * app, so it is never behind a panel. What it made, or why it could not, opens just under it.
 */
export function ExportControl({
  exporting,
  exportedPath,
  exportError,
  onExport,
  onDismiss
}: {
  exporting: boolean
  exportedPath: string | null
  exportError: string | null
  onExport: () => void
  onDismiss: () => void
}): JSX.Element {
  return (
    <div className="relative">
      <Button size="sm" onClick={onExport} disabled={exporting} aria-label={exporting ? 'Exporting video' : 'Export video'}>
        {exporting ? <Spinner size="sm" /> : <Download size={14} />}
        {exporting ? 'Exporting video' : 'Export video'}
      </Button>
      {(exportedPath || exportError) && (
        <div className="absolute right-0 top-full z-40 mt-2 flex w-80 flex-col gap-2 rounded-xl bg-surface p-3 shadow-2xl">
          {exportedPath && <ExportedCard path={exportedPath} onDismiss={onDismiss} />}
          {exportError && <ErrorBanner message={exportError} />}
        </div>
      )}
    </div>
  )
}
