import { useCallback, useEffect, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { Clapperboard } from 'lucide-react'
import { Group, Panel as ResizablePanel, Separator, useDefaultLayout } from 'react-resizable-panels'
import {
  projectClient,
  timelineClient,
  renderClient,
  captureClient,
  transcriptClient,
  agentClient,
  type ProjectMetadata,
  type TimelineItem,
  type TranscriptSegment
} from '../api/projectClient'
import { Timeline } from '../components/Timeline'
import { SourcesPanel } from '../components/SourcesPanel'
import { TransportBar } from '../components/TransportBar'
import { hasStaleVoice, planNarrationCommit, segmentsForItem } from '../lib/clipNarration'
import { onSettingsChanged } from '../lib/settingsChanged'
import { settingsClient } from '../api/projectClient'
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
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'editor-columns', storage: localStorage })
  const stageLayout = useDefaultLayout({ id: 'editor-stage', storage: localStorage })
  const [reorderError, setReorderError] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [narratingItemId, setNarratingItemId] = useState<string | null>(null)
  const [narratingAll, setNarratingAll] = useState(false)
  const [draftingItemId, setDraftingItemId] = useState<string | null>(null)
  const [draftingAll, setDraftingAll] = useState(false)
  const [voice, setVoice] = useState('')
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })
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
    return agentClient.onDrafted((draftedProjectId) => {
      if (draftedProjectId !== projectId) return
      void refreshSegments()
      void refreshTimeline()
    })
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
    setHistory(await projectClient.historyState(projectId))
  }

  const refreshEverything = useCallback(async (): Promise<void> => {
    const [items, transcript, state] = await Promise.all([
      timelineClient.read(projectId),
      transcriptClient.read(projectId),
      projectClient.historyState(projectId)
    ])
    setTimeline(items)
    setSegments(transcript)
    setHistory(state)
  }, [projectId])

  const handleUndo = useCallback(async (): Promise<void> => {
    await projectClient.undo(projectId)
    await refreshEverything()
  }, [projectId, refreshEverything])

  const handleRedo = useCallback(async (): Promise<void> => {
    await projectClient.redo(projectId)
    await refreshEverything()
  }, [projectId, refreshEverything])

  const refreshSegments = useCallback(async (): Promise<void> => {
    setSegments(await transcriptClient.read(projectId))
    setHistory(await projectClient.historyState(projectId))
  }, [projectId])

  // Re-read the voice whenever settings change: narration recorded in the old one is stale.
  useEffect(() => {
    const load = (): void => {
      void settingsClient.read().then((settings) => setVoice(settings.speech.voice))
    }
    load()
    return onSettingsChanged(load)
  }, [])

  const needingNarration = timeline.filter((item) => {
    const segment = segmentsForItem(segments, item.id)[0]
    if (!segment) return false
    return segment.status !== 'narrated' || hasStaleVoice(segments, item.id, voice)
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      // Inside a text field this belongs to the field's own undo, not the project's.
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return
      event.preventDefault()
      void (event.shiftKey ? handleRedo() : handleUndo())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleUndo, handleRedo])

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

  async function handleDraft(item: TimelineItem): Promise<void> {
    setTranscriptError(null)
    setDraftingItemId(item.id)
    try {
      // Asking for a draft on a clip you already wrote is an explicit request to replace it.
      const result = await agentClient.draftItem(projectId, item.id, true)
      if (result.status === 'failed') setTranscriptError(result.reason ?? 'Could not draft this narration.')
      await refreshSegments()
      await refreshTimeline()
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : String(err))
    } finally {
      setDraftingItemId(null)
    }
  }

  async function handleDraftAll(): Promise<void> {
    setTranscriptError(null)
    setDraftingAll(true)
    try {
      const results = await agentClient.draftAll(projectId)
      const failure = results.find((result) => result.status === 'failed')
      if (failure) setTranscriptError(failure.reason ?? 'Could not draft the narration.')
      await refreshSegments()
      await refreshTimeline()
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : String(err))
    } finally {
      setDraftingAll(false)
    }
  }

  async function handleDeleteClip(item: TimelineItem): Promise<void> {
    setReorderError(null)
    try {
      await timelineClient.remove(projectId, item.id)
      await refreshTimeline()
      await refreshSegments()
      setSelectedItemId((current) => (current === item.id ? null : current))
    } catch (err) {
      setReorderError(err instanceof Error ? err.message : String(err))
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
    <Group
      orientation="vertical"
      defaultLayout={stageLayout.defaultLayout}
      onLayoutChanged={stageLayout.onLayoutChanged}
      className="h-full"
    >
      <ResizablePanel id="stage" defaultSize="54" minSize="25">
        <Group
          orientation="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
          className="h-full"
        >
        <ResizablePanel id="sources" collapsible defaultSize="20" minSize="12">
          <div className="h-full border-r border-border bg-bg">
            <SourcesPanel
              project={project}
              timeline={timeline}
              segments={segments}
              totalFrames={computeTimelineDuration(remotionTimeline)}
              recording={recording}
              exporting={exporting}
              exportedPath={exportedPath}
              importError={importError}
              exportError={exportError}
              recordError={recordError}
              onImportImage={handleImportImage}
              onRecordSession={handleRecordSession}
              onExport={handleExport}
            />
          </div>
        </ResizablePanel>
        <Separator className="w-1 bg-border transition-colors hover:bg-accent" />
        <ResizablePanel id="preview" defaultSize="80" minSize="40">
          <div className="flex h-full flex-col bg-bg">
            {/* A dark mat in either theme: footage should be judged against neutral
                surroundings, not against the app's own background. */}
            <div className="flex min-h-0 flex-1 items-center justify-center bg-[#0c0d11] p-4">
              {timeline.length > 0 ? (
                <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg ring-1 ring-white/10">
                  <Player
                    ref={playerRef}
                    component={DemoComposition}
                    inputProps={{ timeline: remotionTimeline }}
                    durationInFrames={computeTimelineDuration(remotionTimeline)}
                    fps={FPS}
                    compositionWidth={WIDTH}
                    compositionHeight={HEIGHT}
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-center">
                  <Clapperboard size={26} className="text-white/30" aria-hidden="true" />
                  <p className="text-sm text-white/50">
                    Record a session or add an image to see it here.
                  </p>
                </div>
              )}
            </div>
            {timeline.length > 0 && (
              <TransportBar
                playerRef={playerRef}
                timeline={timeline}
                totalFrames={computeTimelineDuration(remotionTimeline)}
                onSeek={handleSeek}
              />
            )}
          </div>
        </ResizablePanel>
        </Group>
      </ResizablePanel>
      <Separator className="h-1 bg-border transition-colors hover:bg-accent" />
      <ResizablePanel id="timeline" defaultSize="46" minSize="20">
        <div className="flex h-full flex-col">
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
          currentVoice={voice}
          draftingItemId={draftingItemId}
          draftingAll={draftingAll}
          onDraft={handleDraft}
          onDraftAll={handleDraftAll}
          needingNarration={needingNarration.length}
          onNarrationCommit={handleNarrationCommit}
          onNarrate={handleNarrate}
          onNarrateAll={handleNarrateAll}
          onDelete={handleDeleteClip}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />
        </div>
      </ResizablePanel>
    </Group>
  )
}
