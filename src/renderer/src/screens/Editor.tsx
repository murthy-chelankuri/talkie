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
import { SceneEditor } from '../components/SceneEditor'
import { AboutProjectDialog } from '../components/AboutProjectDialog'
import { EMPTY_CONTEXT, hasProjectContext } from '../../../main/project/projectContext'
import { TransportBar } from '../components/TransportBar'
import { planNarrationCommit, segmentsForItem } from '../lib/clipNarration'
import { voiceProgress } from '../lib/voiceProgress'
import { useMenuActions, useMenuState } from '../lib/menuActions'
import { describeFidelity, type FidelityNote } from '../../../main/tts/voiceFidelity'
import { onSettingsChanged } from '../lib/settingsChanged'
import { settingsClient, type Voice } from '../api/projectClient'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { DemoComposition } from '../../../remotion/DemoComposition'
import { FPS, WIDTH, HEIGHT } from '../../../remotion/constants'
import { computeTimelineDuration } from '../../../remotion/timelineDuration'
import type { TimelineItem as RemotionTimelineItem } from '../../../remotion/types'

/**
 * A draft broke one of this project's rules.
 *
 * Said as what happened rather than as an error, because the words are saved and readable: the
 * user decides whether to fix them, and the point is that they know without proofreading fifty
 * clips for it.
 */
function forbiddenWarning(terms: string[]): string {
  const list = terms.map((term) => `"${term}"`).join(', ')
  return `This draft says ${list}, which this project never says. Edit the words, or change the rule in About this project.`
}

/** Far enough in for a scene's entrance to have finished — see the seek on open below. */
const SETTLED_FRAME = 20

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
  const stageLayout = useDefaultLayout({ id: 'editor-stage', storage: localStorage })
  const [reorderError, setReorderError] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  // Speaker notes read from a .pptx that had to be re-exported as a PDF.
  const pendingNotesRef = useRef<string[]>([])
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [narratingItemId, setNarratingItemId] = useState<string | null>(null)
  const [narratingAll, setNarratingAll] = useState(false)
  const [draftingItemId, setDraftingItemId] = useState<string | null>(null)
  const [draftingAll, setDraftingAll] = useState(false)
  const [appVoice, setAppVoice] = useState('')
  const [voices, setVoices] = useState<Voice[]>([])
  const [editingContext, setEditingContext] = useState(false)
  const [importingDeck, setImportingDeck] = useState(false)
  const [deckProgress, setDeckProgress] = useState<string | null>(null)
  const [recordingItemId, setRecordingItemId] = useState<string | null>(null)
  /** The scene being written or edited: an item to edit, 'new' to start one, null for neither. */
  const [sceneEditing, setSceneEditing] = useState<TimelineItem | 'new' | null>(null)
  // Remembered, because the rail is a working preference rather than a per-session choice.
  const [sourcesCollapsed, setSourcesCollapsed] = useState(
    () => localStorage.getItem('talkie.sourcesCollapsed') === 'true'
  )
  const recorderRef = useRef<{ stop: () => Promise<Uint8Array>; cancel: () => void } | null>(null)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })
  const playerRef = useRef<PlayerRef>(null)
  const openedAtFrame = useRef(false)

  /**
   * Open on a frame that shows something.
   *
   * Scenes animate in, so frame 0 of a project that starts with one is a legitimately empty
   * picture — and parking there means the largest thing on screen is blank every time a project
   * is opened, with nothing to say whether the project has content at all. Landing just past the
   * entrance shows the work instead. Scrubbing back to zero still shows the fade, which is real.
   */
  useEffect(() => {
    if (openedAtFrame.current || timeline.length === 0) return

    const first = timeline[0]
    const settled = Math.min(SETTLED_FRAME, Math.max(0, Math.floor(first.duration / 2)))
    if (settled > 0) {
      // A frame late enough for the entrance to have played, and the player has to exist first.
      requestAnimationFrame(() => playerRef.current?.seekTo(first.start + settled))
    }
    openedAtFrame.current = true
  }, [timeline])

  useEffect(() => {
    openedAtFrame.current = false
  }, [projectId])

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
    localStorage.setItem('talkie.sourcesCollapsed', String(sourcesCollapsed))
  }, [sourcesCollapsed])

  // A collapsed rail has no room for an error, and an error nobody can read is worse than the
  // failure itself — so anything that went wrong opens the panel to say so.
  useEffect(() => {
    if (importError || exportError || recordError) setSourcesCollapsed(false)
  }, [importError, exportError, recordError])

  useEffect(() => {
    return () => recorderRef.current?.cancel()
  }, [])

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
      void settingsClient.read().then((settings) => setAppVoice(settings.speech.voice))
    }
    load()
    // The list of voices this machine has, for the project's own voice picker.
    void settingsClient.voices().then(setVoices)
    return onSettingsChanged(load)
  }, [])

  /**
   * The voice this project speaks in.
   *
   * A project's own voice wins over the one set in Settings, so changing the voice you prefer
   * for new work leaves finished projects sounding as they did — and reading as finished.
   */
  const voice = project?.voice || appVoice

  // Having no voice and having a different voice are different situations — see voiceProgress.
  const progress = voiceProgress(timeline, segments, voice)

  /**
   * Why the project sounds the way it does, measured from the takes on disk.
   *
   * Keyed on the takes themselves rather than on `segments`, which changes on every keystroke in
   * the words box: re-reading sixty wav headers to answer a question about audio nobody has
   * touched would be work done for nothing.
   */
  const [fidelityNote, setFidelityNote] = useState<FidelityNote | null>(null)
  const takeKey = segments
    .filter((segment) => segment.status === 'narrated' && segment.audioFile)
    .map((segment) => `${segment.audioFile}:${segment.voice ?? ''}`)
    .join('|')

  useEffect(() => {
    let cancelled = false
    void transcriptClient
      .fidelity(projectId)
      .then((fidelity) => {
        if (!cancelled) setFidelityNote(describeFidelity(fidelity))
      })
      // A note that cannot be worked out is a note not shown; nothing here is worth an error.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId, takeKey])

  /** Adopt the voice this project's narration was already read in, changing nothing on disk. */
  async function handleKeepProjectVoice(): Promise<void> {
    const keeping = progress.previousVoice
    if (!keeping) return
    setProject(await projectClient.setVoice(projectId, keeping))
  }

  /**
   * Change the voice this project speaks in, at any point, to anything — including back to
   * following the app's. Nothing already recorded is touched: the mismatch card then offers to
   * re-speak, which is the only place work gets redone.
   */
  async function handleProjectVoiceChange(next: string | null): Promise<void> {
    setProject(await projectClient.setVoice(projectId, next))
  }
  const needingNarration = progress.needing

  useMenuState({ canUndo: history.canUndo, canRedo: history.canRedo })

  /**
   * Undo means different things depending on where the cursor is.
   *
   * On the timeline it steps the project back. Inside a text field it has to stay the field's
   * own undo, or typing a sentence and pressing Cmd-Z would throw away the last clip you moved.
   * The keyboard handler below already drew that line; the menu item now asks the same question,
   * because an accelerator on a menu item takes the keystroke before the window ever sees it.
   */
  const editingText = (): boolean => {
    const el = document.activeElement as HTMLElement | null
    return Boolean(el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable))
  }

  useMenuActions({
    undo: () => {
      if (editingText()) document.execCommand('undo')
      else void handleUndo()
    },
    redo: () => {
      if (editingText()) document.execCommand('redo')
      else void handleRedo()
    },
    'import-image': () => void handleImportImage(),
    'import-deck': () => void handleImportDeck(),
    'add-scene': () => setSceneEditing('new'),
    'record-session': () => void handleRecordSession(),
    'export-video': () => void handleExport(),
    'draft-all': () => void handleDraftAll(),
    'speak-all': () => void handleNarrateAll(),
    'project-context': () => setEditingContext(true)
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

  async function handleImportDeck(): Promise<void> {
    setImportError(null)
    setImportingDeck(true)
    setDeckProgress(null)
    try {
      const deck = await projectClient.chooseDeck(projectId)
      if (deck.status === 'cancelled') return

      if (deck.status === 'needs-pdf') {
        // The notes were readable even though the slides were not; keep them for the PDF.
        pendingNotesRef.current = deck.notes
        setImportError(deck.reason)
        return
      }

      setDeckProgress('Reading the deck…')
      const { renderPdfPages } = await import('../lib/renderPdfPages')
      const pages = await renderPdfPages(deck.pdf, (done, total) =>
        setDeckProgress(`Rendering slide ${done} of ${total}…`)
      )

      // Notes carried over from a .pptx the app could not render itself.
      const notes = deck.notes.length > 0 ? deck.notes : pendingNotesRef.current
      pendingNotesRef.current = []

      setDeckProgress('Adding slides to the timeline…')
      await projectClient.saveSlides(projectId, pages, notes)
      await refreshTimeline()
      await refreshSegments()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    } finally {
      setImportingDeck(false)
      setDeckProgress(null)
    }
  }

  /**
   * Record a take in the user's own voice over this clip. The narration text stays as it is —
   * it is the script being read from, not something the recording replaces.
   */
  async function handleRecord(item: TimelineItem): Promise<void> {
    setTranscriptError(null)
    try {
      // macOS must be asked before the page touches the microphone.
      const access = await transcriptClient.requestMicrophone()
      if (!access.granted) {
        setTranscriptError(access.reason ?? 'The microphone is not available.')
        return
      }

      const { startVoiceRecording } = await import('../lib/voiceRecorder')
      recorderRef.current = await startVoiceRecording()
      setRecordingItemId(item.id)
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleStopRecording(): Promise<void> {
    const recorder = recorderRef.current
    const itemId = recordingItemId
    recorderRef.current = null
    setRecordingItemId(null)
    if (!recorder || !itemId) return

    try {
      const audio = await recorder.stop()

      // The recording needs a segment to attach to; a clip may have words but no saved segment
      // yet if the user never blurred the box.
      let segment = segmentsForItem(segments, itemId)[0]
      if (!segment) {
        segment = await transcriptClient.addSegment(projectId, { text: ' ', timelineItemId: itemId })
      }

      await transcriptClient.saveRecording(projectId, segment.id, audio)
      await refreshSegments()
      await refreshTimeline()
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleDraft(item: TimelineItem): Promise<void> {
    setTranscriptError(null)
    setDraftingItemId(item.id)
    try {
      // Asking for a draft on a clip you already wrote is an explicit request to replace it.
      const result = await agentClient.draftItem(projectId, item.id, true)
      if (result.status === 'failed') setTranscriptError(result.reason ?? 'Could not draft this narration.')
      // Saved either way — it may be most of the way there — but never quietly.
      if (result.forbidden?.length) setTranscriptError(forbiddenWarning(result.forbidden))
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

      // Across a whole project this is the case that matters: nobody proofreads fifty clips for
      // a word they asked not to hear.
      const broken = [...new Set(results.flatMap((result) => result.forbidden ?? []))]
      if (!failure && broken.length > 0) {
        const clips = results.filter((result) => result.forbidden?.length).length
        setTranscriptError(
          `${clips} draft${clips === 1 ? '' : 's'} said ${broken
            .map((term) => `"${term}"`)
            .join(', ')}, which this project never says. Look for the clips in question before voicing them.`
        )
      }
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
      <ResizablePanel id="stage" defaultSize="62" minSize="25">
        <div className="flex h-full">
            <SourcesPanel
              project={project}
              timeline={timeline}
              segments={segments}
              totalFrames={computeTimelineDuration(remotionTimeline)}
              progress={progress}
              currentVoice={voice}
              fidelityNote={fidelityNote}
              onKeepProjectVoice={handleKeepProjectVoice}
              hasContext={hasProjectContext(project?.context)}
              onEditContext={() => setEditingContext(true)}
              projectVoice={project?.voice ?? null}
              appVoice={appVoice}
              voices={voices}
              onProjectVoiceChange={(next) => void handleProjectVoiceChange(next)}
              onAddScene={() => setSceneEditing('new')}
              recording={recording}
              exporting={exporting}
              exportedPath={exportedPath}
              importError={importError}
              exportError={exportError}
              recordError={recordError}
              onImportImage={handleImportImage}
          onImportDeck={handleImportDeck}
          importingDeck={importingDeck}
          deckProgress={deckProgress}
              onRecordSession={handleRecordSession}
              onExport={handleExport}
              onDismissExport={() => setExportedPath(null)}
              collapsed={sourcesCollapsed}
              onToggleCollapsed={() => setSourcesCollapsed((open) => !open)}
            />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-full flex-col bg-bg">
            {/* The mat stops at the video. Filling the pane with near-black left a slab of it
                either side of a 16:9 frame in a wide, short pane, which reads as waste rather
                than as matting; the area around the frame is the app's own surface instead. */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-bg p-2">
              {timeline.length > 0 ? (
                /* Sized to the video rather than to the pane: filling the pane and letting the
                   player letterbox inside it framed a slab of black with the demo in the middle
                   of it. Absolute inset with auto margins is what fits a fixed ratio into a box
                   of any shape and centres it. */
                <div className="absolute inset-2 m-auto aspect-video max-h-full max-w-full overflow-hidden rounded-lg bg-[#0c0d11] shadow-lg ring-1 ring-border">
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
                  <Clapperboard size={26} className="text-text-muted" aria-hidden="true" />
                  {/* What this region is, not what to do: the panel beside it and the timeline
                      below both say that already, and a screen that gives the same instruction
                      three times is not being clearer. */}
                  <p className="text-sm text-text-muted">Your project will play here</p>
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
        </div>
        </div>
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
          recordingItemId={recordingItemId}
          onEditScene={(item) => setSceneEditing(item)}
          onRecord={handleRecord}
          onStopRecording={handleStopRecording}
          draftingItemId={draftingItemId}
          draftingAll={draftingAll}
          onDraft={handleDraft}
          onDraftAll={handleDraftAll}
          progress={progress}
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
      {editingContext && project && (
        <AboutProjectDialog
          projectName={project.name}
          context={project.context ?? EMPTY_CONTEXT}
          onClose={() => setEditingContext(false)}
          onSave={async (context) => setProject(await projectClient.setContext(projectId, context))}
        />
      )}

      {sceneEditing && project && (
        <SceneEditor
          projectId={projectId}
          projectName={project.name}
          item={sceneEditing === 'new' ? null : sceneEditing}
          onClose={() => setSceneEditing(null)}
          onSaved={async () => {
            await refreshTimeline()
            await refreshSegments()
          }}
        />
      )}
    </Group>
  )
}
