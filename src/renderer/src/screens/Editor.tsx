import { useCallback, useEffect, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { Group, Panel as ResizablePanel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { CircleCheck, Circle, Download, ImagePlus } from 'lucide-react'
import {
  projectClient,
  timelineClient,
  renderClient,
  captureClient,
  transcriptClient,
  type ProjectMetadata,
  type TimelineItem,
  type TranscriptSegment
} from '../api/projectClient'
import { Timeline } from '../components/Timeline'
import { planNarrationCommit, segmentsForItem } from '../lib/clipNarration'
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
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'editor-layout-v2', storage: localStorage })
  const [reorderError, setReorderError] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [narratingItemId, setNarratingItemId] = useState<string | null>(null)
  const [narratingAll, setNarratingAll] = useState(false)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const playerRef = useRef<PlayerRef>(null)

  useEffect(() => {
    Promise.all([
      projectClient.open(projectId),
      timelineClient.read(projectId),
      transcriptClient.read(projectId)
    ])
      .then(([openedProject, items, transcript]) => {
        setProject(openedProject)
        setTimeline(items)
        setSegments(transcript)
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

  const refreshSegments = useCallback(async (): Promise<void> => {
    setSegments(await transcriptClient.read(projectId))
  }, [projectId])

  const needingNarration = timeline.filter((item) => {
    const segment = segmentsForItem(segments, item.id)[0]
    return segment && segment.status !== 'narrated'
  })

  const handleSeek = useCallback((frame: number): void => {
    playerRef.current?.seekTo(frame)
  }, [])

  function handleSelectClip(item: TimelineItem): void {
    setSelectedItemId(item.id)
    handleSeek(item.start)
  }

  function handleSelectSegment(segment: TranscriptSegment): void {
    setSelectedSegmentId(segment.id)
    const item = timeline.find((candidate) => candidate.id === segment.timelineItemId)
    if (item) {
      setSelectedItemId(item.id)
      handleSeek(item.start)
    }
  }

  async function handleReorder(orderedIds: string[]): Promise<void> {
    const byId = new Map(timeline.map((item) => [item.id, item]))
    setTimeline(orderedIds.map((id) => byId.get(id) as TimelineItem))
    setReorderError(null)
    try {
      setTimeline(await timelineClient.reorder(projectId, orderedIds))
    } catch (err) {
      setReorderError(err instanceof Error ? err.message : String(err))
      await refreshTimeline()
    }
  }

  async function handleNarrationCommit(item: TimelineItem, text: string): Promise<void> {
    const plan = planNarrationCommit(segments, item.id, text)
    if (plan.action === 'none') return

    setTranscriptError(null)
    try {
      if (plan.action === 'create') {
        await transcriptClient.addSegment(projectId, { text: plan.text, timelineItemId: item.id })
      } else if (plan.action === 'update') {
        await transcriptClient.updateText(projectId, plan.id, plan.text)
        for (const id of plan.removeIds) {
          await transcriptClient.deleteSegment(projectId, id)
        }
      } else {
        for (const id of plan.removeIds) {
          await transcriptClient.deleteSegment(projectId, id)
        }
      }
      await refreshSegments()
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : String(err))
    }
  }

  async function narrateItem(item: TimelineItem): Promise<void> {
    const segment = segmentsForItem(segments, item.id)[0]
    if (!segment) return
    await transcriptClient.narrate(projectId, segment.id)
  }

  async function handleNarrate(item: TimelineItem): Promise<void> {
    setTranscriptError(null)
    setNarratingItemId(item.id)
    try {
      await narrateItem(item)
      await refreshSegments()
      await refreshTimeline()
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : String(err))
    } finally {
      setNarratingItemId(null)
    }
  }

  async function handleNarrateAll(): Promise<void> {
    setTranscriptError(null)
    setNarratingAll(true)
    try {
      for (const item of needingNarration) {
        setNarratingItemId(item.id)
        await narrateItem(item)
      }
      await refreshSegments()
      await refreshTimeline()
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : String(err))
    } finally {
      setNarratingItemId(null)
      setNarratingAll(false)
    }
  }

  async function handleSplit(item: TimelineItem, atFrame: number): Promise<void> {
    setReorderError(null)
    try {
      await timelineClient.split(projectId, item.id, atFrame)
      await refreshTimeline()
    } catch (err) {
      setReorderError(err instanceof Error ? err.message : String(err))
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
        <ResizablePanel id="preview" defaultSize="80" minSize="40">
          <div className="flex h-full items-center justify-center bg-bg p-4">
            {timeline.length > 0 ? (
              <Player
                ref={playerRef}
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
      </Group>
      <div className="flex flex-col">
        {(reorderError || transcriptError) && (
          <div className="flex flex-col gap-2 px-3 pt-2">
            {reorderError && <ErrorBanner message={reorderError} />}
            {transcriptError && <ErrorBanner message={transcriptError} />}
          </div>
        )}
        <Timeline
          timeline={timeline}
          segments={segments}
          totalFrames={computeTimelineDuration(remotionTimeline)}
          playerRef={playerRef}
          selectedItemId={selectedItemId}
          onSeek={handleSeek}
          onSelectItem={handleSelectClip}
          onReorder={handleReorder}
          onSplit={handleSplit}
          onActiveItemChange={setActiveItemId}
          narratingItemId={narratingItemId}
          narratingAll={narratingAll}
          needingNarration={needingNarration.length}
          onNarrationCommit={handleNarrationCommit}
          onNarrate={handleNarrate}
          onNarrateAll={handleNarrateAll}
        />
      </div>
    </div>
  )
}
