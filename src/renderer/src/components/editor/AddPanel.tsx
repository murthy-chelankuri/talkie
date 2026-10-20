import { Clapperboard, Film, FileVideo, ImagePlus, LayoutTemplate, Presentation } from 'lucide-react'
import { ErrorBanner } from '../ui/ErrorBanner'
import { Action } from './parts'

/** Every way of putting something on the timeline, recording first because it is what Talkie is for. */
export function AddPanel({
  recording,
  importingDeck,
  importingVideo,
  deckProgress,
  isEmpty,
  importError,
  recordError,
  onRecordSession,
  onImportImage,
  onImportVideo,
  onAddScene,
  onImportDeck
}: {
  recording: boolean
  importingDeck: boolean
  importingVideo: boolean
  deckProgress: string | null
  isEmpty: boolean
  importError: string | null
  recordError: string | null
  onRecordSession: () => void
  onImportImage: () => void
  onImportVideo: () => void
  onAddScene: () => void
  onImportDeck: () => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <Action
        icon={<Clapperboard size={15} />}
        label="Record a session"
        hint="Capture a walkthrough"
        primary
        tone="record"
        busy={recording}
        disabled={recording}
        onClick={onRecordSession}
      />
      <Action icon={<LayoutTemplate size={15} />} label="Add a scene" hint="A slide, steps, a chart, a quote — or describe one" tone="scene" onClick={onAddScene} />
      <Action
        icon={<Presentation size={15} />}
        label={importingDeck ? 'Importing slides' : 'Import slides'}
        hint={importingDeck ? (deckProgress ?? 'Working…') : 'From a .pptx or .pdf deck'}
        tone="slides"
        busy={importingDeck}
        disabled={importingDeck}
        onClick={onImportDeck}
      />
      <Action
        icon={<FileVideo size={15} />}
        label={importingVideo ? 'Importing a video' : 'Import a video'}
        hint={importingVideo ? 'Finding where its scenes change…' : 'One already made, cut into scenes'}
        tone="media"
        busy={importingVideo}
        disabled={importingVideo}
        onClick={onImportVideo}
      />
      <Action icon={<ImagePlus size={15} />} label="Add an image" hint="Drop in a slide or screenshot" tone="media" onClick={onImportImage} />

      {recording && (
        <p className="mt-1 flex items-center gap-2 text-[11px] text-danger" title="Recording in progress">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden="true" />
          Recording in progress
        </p>
      )}

      {(importError || recordError) && (
        <div className="mt-1 flex flex-col gap-2">
          {importError && <ErrorBanner message={importError} />}
          {recordError && <ErrorBanner message={recordError} />}
        </div>
      )}

      {isEmpty && (
        <p className="mt-2 flex items-start gap-2 text-[11px] text-text-muted">
          <Film size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          Record a session, import a video or add an image to start the timeline.
        </p>
      )}
    </div>
  )
}
