import { useEffect, useState } from 'react'
import { Player } from '@remotion/player'
import { Group, Panel as ResizablePanel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CircleCheck, Circle, Download, ImagePlus } from 'lucide-react'
import {
  projectClient,
  timelineClient,
  renderClient,
  captureClient,
  type ProjectMetadata,
  type TimelineItem
} from '../api/projectClient'
import { TranscriptPanel } from '../components/TranscriptPanel'
import { Panel } from '../components/ui/Panel'
import { Toolbar } from '../components/ui/Toolbar'
import { IconButton } from '../components/ui/IconButton'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { DemoComposition } from '../../../remotion/DemoComposition'
import { FPS, WIDTH, HEIGHT } from '../../../remotion/constants'
import { computeTimelineDuration } from '../../../remotion/timelineDuration'
import type { TimelineItem as RemotionTimelineItem } from '../../../remotion/types'

export function Editor({ projectId }: { projectId: string }): JSX.Element {
  const [project, setProject] = useState<ProjectMetadata | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'editor-layout', storage: localStorage })
  const [reorderError, setReorderError] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    Promise.all([projectClient.open(projectId), timelineClient.read(projectId)])
      .then(([openedProject, items]) => {
        setProject(openedProject)
        setTimeline(items)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [projectId])

  useEffect(() => {
    return captureClient.onSessionImported((importedProjectId) => {
      if (importedProjectId !== projectId) return
      timelineClient
        .read(projectId)
        .then(setTimeline)
        .catch((err: unknown) => setRecordError(err instanceof Error ? err.message : String(err)))
    })
  }, [projectId])

  async function refreshTimeline(): Promise<void> {
    setTimeline(await timelineClient.read(projectId))
  }

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = timeline.findIndex((item) => item.id === active.id)
    const newIndex = timeline.findIndex((item) => item.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(timeline, oldIndex, newIndex)
    setTimeline(reordered)
    setReorderError(null)
    try {
      const updated = await timelineClient.reorder(
        projectId,
        reordered.map((item) => item.id)
      )
      setTimeline(updated)
    } catch (err) {
      setReorderError(err instanceof Error ? err.message : String(err))
      await refreshTimeline()
    }
  }

  async function handleImportImage(): Promise<void> {
    setImportError(null)
    try {
      const item = await projectClient.importImage(projectId)
      if (item) {
        await refreshTimeline()
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleExport(): Promise<void> {
    setExporting(true)
    setExportError(null)
    setExportedPath(null)
    try {
      const path = await renderClient.exportVideo(projectId)
      setExportedPath(path)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  async function handleRecordSession(): Promise<void> {
    setRecordError(null)
    setRecording(true)
    try {
      await captureClient.openToolbar(projectId)
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : String(err))
    } finally {
      setRecording(false)
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorBanner message={error} />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="md" label="Loading project" />
      </div>
    )
  }

  // Cast: schema.ts's zod-inferred TimelineItem treats `data` as optional (z.unknown() accepts
  // undefined), while remotion/types.ts's hand-written TimelineItem requires it. Both describe
  // the same real shape validated by TimelineItemSchema.superRefine, so the optionality is a
  // static-typing artifact, not a runtime possibility. Same workaround as renderProject.ts /
  // timelineHandlers.ts.
  const remotionTimeline = timeline as unknown as RemotionTimelineItem[]

  return (
    <div className="flex h-full flex-col">
      <Group
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="min-h-0 flex-1"
      >
        <ResizablePanel id="sources" collapsible defaultSize="20" minSize="12">
          <Panel title="Sources & Agents" className="h-full">
            <Toolbar className="border-0 bg-transparent p-0">
              <IconButton aria-label="Import Image" onClick={handleImportImage}>
                <ImagePlus size={16} />
              </IconButton>
              <IconButton
                aria-label={exporting ? 'Exporting video' : 'Export video'}
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? <Spinner size="sm" /> : <Download size={16} />}
              </IconButton>
              <IconButton
                aria-label={recording ? 'Recording in progress' : 'Record session'}
                onClick={handleRecordSession}
                disabled={recording}
              >
                {recording ? <Spinner size="sm" /> : <Circle size={16} />}
              </IconButton>
            </Toolbar>
            {recording && (
              <span className="mt-2 flex items-center gap-1.5 text-xs text-danger">
                <span className="h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden="true" />
                Recording…
              </span>
            )}
            {exportedPath && (
              <span className="mt-2 flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1 text-xs text-text-muted">
                <CircleCheck size={14} className="text-accent" aria-hidden="true" />
                Exported to {exportedPath}
              </span>
            )}
            <div className="mt-2 flex flex-col gap-2">
              {importError && <ErrorBanner message={importError} />}
              {exportError && <ErrorBanner message={exportError} />}
              {recordError && <ErrorBanner message={recordError} />}
            </div>
          </Panel>
        </ResizablePanel>
        <Separator className="w-1 bg-border transition-colors hover:bg-accent" />
        <ResizablePanel id="preview" defaultSize="55" minSize="30">
          <div className="flex h-full items-center justify-center bg-bg p-4">
            {timeline.length > 0 ? (
              <Player
                component={DemoComposition}
                inputProps={{ timeline: remotionTimeline }}
                durationInFrames={computeTimelineDuration(remotionTimeline)}
                fps={FPS}
                compositionWidth={WIDTH}
                compositionHeight={HEIGHT}
                style={{ width: '100%', height: '100%' }}
                controls
              />
            ) : (
              <p className="text-sm text-text-muted">Preview — {project.name}</p>
            )}
          </div>
        </ResizablePanel>
        <Separator className="w-1 bg-border transition-colors hover:bg-accent" />
        <ResizablePanel id="transcript" collapsible defaultSize="25" minSize="15">
          <Panel title="Transcript" className="h-full">
            <TranscriptPanel projectId={projectId} timeline={timeline} onTimelineChange={refreshTimeline} />
          </Panel>
        </ResizablePanel>
      </Group>
      <footer className="flex h-40 flex-col gap-1 border-t border-border bg-surface p-2">
        {reorderError && <ErrorBanner message={reorderError} />}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={timeline.map((item) => item.id)} strategy={horizontalListSortingStrategy}>
            <div className="flex flex-1 items-center gap-2 overflow-x-auto">
              {timeline.map((item) => (
                <TimelineClip key={item.id} item={item} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </footer>
    </div>
  )
}

function TimelineClip({ item }: { item: TimelineItem }): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      {...attributes}
      {...listeners}
      className="flex h-full w-32 shrink-0 cursor-grab items-center justify-center rounded-md border border-border bg-bg text-sm text-text active:cursor-grabbing"
    >
      {item.kind}
    </div>
  )
}
