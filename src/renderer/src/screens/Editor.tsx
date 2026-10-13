import { useCallback, useEffect, useRef, useState } from 'react'
import { Preview, type PreviewHandle } from '../../../video/preview'
import { Clapperboard, Maximize2, Minimize2 } from 'lucide-react'
import {
  Group,
  Panel as ResizablePanel,
  Separator,
  useDefaultLayout
} from 'react-resizable-panels'
import {
  projectClient,
  timelineClient,
  renderClient,
  captureClient,
  transcriptClient,
  agentClient,
  sceneClient,
  htmlSceneClient,
  type ProjectMetadata,
  type TimelineItem,
  type TranscriptSegment
} from '../api/projectClient'
import { Timeline } from '../components/Timeline'
import { ScriptView } from '../components/ScriptView'
import { AskTheAgent } from '../components/AskTheAgent'
import { drawPendingDiagrams } from '../lib/drawPendingDiagrams'
import { cn } from '../lib/cn'
import { TopBarActions } from '../components/AppShell'
import { SidePanel } from '../components/ui/SidePanel'
import { EditorRail } from '../components/editor/EditorRail'
import { useRailPanel, type RailPanelId } from '../components/editor/useRailPanel'
import { ResizeHandle, useResizableWidth } from '../components/editor/ResizeHandle'
import { ProjectPanel } from '../components/editor/ProjectPanel'
import { AddPanel } from '../components/editor/AddPanel'
import { VoicePanel } from '../components/editor/VoicePanel'
import { exampleVoiceNote } from '../lib/exampleVoice'
import { ExportControl, type ExportState } from '../components/editor/ExportControl'
import { Inspector } from '../components/editor/Inspector'
import { useScriptFocus } from '../components/editor/useScriptFocus'
import { diagramStamp } from '../../../main/themes/diagrams'
import { SceneEditor } from '../components/SceneEditor'
import { AboutProjectDialog } from '../components/AboutProjectDialog'
import { ThemeContext, type RenderTheme } from '../../../remotion/renderTheme'
import { EMPTY_CONTEXT, hasProjectContext } from '../../../main/project/projectContext'
import { TransportBar } from '../components/TransportBar'
import { Button } from '../components/ui/Button'
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

const PANES = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'script', label: 'Script' }
] as const

const RAIL_TITLES: Record<RailPanelId, string> = {
  project: 'Project',
  add: 'Add to the video',
  voice: 'Voice',
  agent: 'Ask the agent'
}

export function Editor({ projectId }: { projectId: string }): JSX.Element {
  const [project, setProject] = useState<ProjectMetadata | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' })
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
  const [appEngine, setAppEngine] = useState('')
  const [voices, setVoices] = useState<Voice[]>([])
  const [editingContext, setEditingContext] = useState(false)
  const [importingDeck, setImportingDeck] = useState(false)
  const [deckProgress, setDeckProgress] = useState<string | null>(null)
  const [recordingItemId, setRecordingItemId] = useState<string | null>(null)
  /** The scene being written or edited: an item to edit, 'new' to start one, null for neither. */
  const [sceneEditing, setSceneEditing] = useState<TimelineItem | 'new' | null>(null)
  // Operating the timeline and writing the script are different jobs wanting different shapes
  // of room, so the bottom pane does one at a time. See ScriptView.
  const [bottomPane, setBottomPane] = useState<'timeline' | 'script'>('timeline')
  const scriptFocus = useScriptFocus(bottomPane === 'script')
  const focused = scriptFocus.focused
  // Which side panel is open — at most one — and how wide it is, both remembered on this Mac.
  const rail = useRailPanel()
  const [sideWidth, setSideWidth] = useResizableWidth('talkie.sidePanelWidth', 300, 260, 420)
  // The agent can be working with its panel shut; the rail says so.
  const [agentWorking, setAgentWorking] = useState(false)
  const [inspectorWidth, setInspectorWidth] = useResizableWidth('talkie.inspectorWidth', 280, 240, 380)
  const recorderRef = useRef<{ stop: () => Promise<Uint8Array>; cancel: () => void } | null>(null)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })
  const playerRef = useRef<PreviewHandle>(null)
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

  // The project's theme, as the composition draws it. Read again whenever the project says it has
  // a different one; null for a project without, which draws as it always did.
  // Undefined until it has been asked for, which is not the same as having none: drawing diagrams
  // before then would draw a themed project's diagrams plain, and then again in its colours.
  const [renderTheme, setRenderTheme] = useState<RenderTheme | null | undefined>(undefined)
  const renderThemeRef = useRef<RenderTheme | null | undefined>(undefined)
  renderThemeRef.current = renderTheme
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      projectClient
        .renderTheme(projectId)
        .then((theme) => {
          if (!cancelled) setRenderTheme(theme)
        })
        .catch(() => {
          if (!cancelled) setRenderTheme(null)
        })
    }
    load()
    // The theme itself can be edited in Settings with this project open behind it.
    const stopListening = onSettingsChanged(load)
    return () => {
      cancelled = true
      stopListening()
    }
  }, [projectId, project?.themeId])

  // Diagrams carry their colours in their pictures, so a theme that arrives or changes — on
  // opening the project, or on choosing another — means drawing them again. See diagrams.ts.
  useEffect(() => {
    if (renderTheme === undefined) return
    let cancelled = false
    void timelineClient.read(projectId).then(async (items) => {
      if (cancelled) return
      if ((await drawPendingDiagrams(projectId, items, renderTheme)) > 0 && !cancelled) {
        setTimeline(await timelineClient.read(projectId))
      }
    })
    return () => {
      cancelled = true
    }
  }, [projectId, renderTheme?.stamp])

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

  // An error nobody can read is worse than the failure itself, so a failed import or recording
  // opens the panel that says so. An export's failure shows under Export, in the top bar.
  const showRailPanel = rail.show
  useEffect(() => {
    if (importError || recordError) showRailPanel('add')
  }, [importError, recordError, showRailPanel])

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

  // Progress for this project's export only; a report that arrives after it has ended is dropped.
  useEffect(() => {
    return renderClient.onExportProgress((exportingProjectId, progress) => {
      if (exportingProjectId !== projectId) return
      setExportState((state) => (state.status === 'running' ? { ...state, progress } : state))
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
    const items = await timelineClient.read(projectId)
    setTimeline(items)
    setHistory(await projectClient.historyState(projectId))

    // An agent can write mermaid source but cannot draw it — there is no browser where it
    // runs. This is where the drawing happens, so its diagram is a picture rather than a blank
    // clip. See drawPendingDiagrams.
    const theme = renderThemeRef.current
    if (theme !== undefined && (await drawPendingDiagrams(projectId, items, theme)) > 0) {
      setTimeline(await timelineClient.read(projectId))
    }
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
      void settingsClient.read().then((settings) => {
        setAppVoice(settings.speech.voice)
        setAppEngine(settings.speech.engine)
      })
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

  /**
   * A scene's look, changed from the inspector. Only the fields that belong to the scene are
   * written back: the timeline the editor holds has asset URLs where the files' paths are kept,
   * and a diagram's picture has its colours in it, so it is drawn again in the new look first.
   */
  async function handleLook(item: TimelineItem, look: 'brand' | 'light' | 'dark'): Promise<void> {
    setReorderError(null)
    try {
      const data = item.data as {
        title?: string
        bullets?: string[]
        layout?: string
        source?: string
        style?: Record<string, unknown>
      }
      const style = { ...data.style, theme: look }
      if (item.kind === 'html') {
        await htmlSceneClient.edit(projectId, item.id, { style: { theme: look } })
      } else if (item.kind === 'diagram') {
        const { renderMermaid } = await import('../lib/renderMermaid')
        const theme = renderTheme ?? null
        const { svg } = await renderMermaid(data.source ?? '', theme, look)
        const src = await sceneClient.saveSvg(projectId, svg)
        await sceneClient.update(projectId, item.id, {
          source: data.source,
          src,
          style,
          ...(data.title ? { title: data.title } : {}),
          ...(theme ? { themeStamp: diagramStamp(theme, look) } : {})
        })
      } else {
        await sceneClient.update(projectId, item.id, {
          title: data.title ?? '',
          bullets: data.bullets ?? [],
          style,
          ...(data.layout ? { layout: data.layout } : {})
        })
      }
      await refreshTimeline()
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
    if (exportState.status === 'running') return
    setExportState({ status: 'running', progress: { stage: 'preparing', fraction: 0, renderedFrames: 0, totalFrames: 0 }, startedAt: Date.now() })
    try {
      setExportState(await renderClient.exportVideo(projectId))
    } catch (err) {
      setExportState({ status: 'failed', message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleCancelExport(): Promise<void> {
    setExportState((state) => (state.status === 'running' ? { ...state, cancelling: true } : state))
    await renderClient.cancelExport(projectId)
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

  // The timeline and the script, built once and placed either under the stage or, while the
  // script has the window, on their own.
  const workPane = (
        <div className="flex h-full flex-col overflow-hidden rounded-xl bg-surface">
        {(reorderError || transcriptError) && (
          <div className="flex flex-col gap-2 px-3 pt-2">
            {reorderError && <ErrorBanner message={reorderError} />}
            {transcriptError && <ErrorBanner message={transcriptError} />}
          </div>
        )}
        {/* Two ways of working on the same project rather than a filter over one, so it is
            built as a switch between them: the tab that is on carries the material of the pane
            it opens — graphite for the timeline, paper for the script — which is the same
            signal the panes themselves use. */}
        <div className="flex shrink-0 items-center px-4 pt-2">
        <div
          role="tablist"
          aria-label="Ways to work on this project"
          className="flex items-end gap-5"
        >
          {PANES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={bottomPane === id}
              onClick={() => {
                setBottomPane(id)
                if (id === 'timeline') scriptFocus.leave()
              }}
              className={cn(
                'relative pb-2 pt-1 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                bottomPane === id ? 'font-medium text-text' : 'text-text-muted hover:text-text'
              )}
            >
              {label}
              {/* The script's tab is underlined in paper, the timeline's in the accent: the same
                  signal the panes themselves carry. */}
              {bottomPane === id && (
                <span
                  aria-hidden="true"
                  className={cn('absolute inset-x-0 bottom-0 h-0.5 rounded-full', id === 'script' ? 'bg-paper-border' : 'bg-accent-fill')}
                />
              )}
            </button>
          ))}
        </div>
        {bottomPane === 'script' && timeline.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-[12px] text-text-muted hover:text-text"
            aria-pressed={focused}
            title={focused ? 'Show the video again (Esc)' : 'Give the script the whole window'}
            onClick={scriptFocus.toggle}
          >
            {focused ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
            {focused ? 'Show the video' : 'Focus on the script'}
          </Button>
        )}
        </div>
        {/* Thumbnails draw slides and diagrams in the project's theme, as the video does. */}
        <ThemeContext.Provider value={renderTheme ?? null}>
        {bottomPane === 'script' ? (
          <ScriptView
            timeline={timeline}
            segments={segments}
            activeItemId={activeItemId}
            draftingItemId={draftingItemId}
            narratingItemId={narratingItemId}
            recordingItemId={recordingItemId}
            onRecord={handleRecord}
            onStopRecording={handleStopRecording}
            playerRef={playerRef}
            onSeek={handleSeek}
            onSelectItem={handleSelectClip}
            onCommit={handleNarrationCommit}
            onDraft={handleDraft}
            onNarrate={handleNarrate}
          />
        ) : (
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
        )}
        </ThemeContext.Provider>
        </div>
  )

  return (
    <div className="flex h-full gap-2 bg-bg pb-2 pr-2">
      <TopBarActions>
        <ExportControl
          state={exportState}
          onExport={handleExport}
          onCancel={handleCancelExport}
          onDismiss={() => setExportState({ status: 'idle' })}
        />
      </TopBarActions>
      <EditorRail open={rail.open} onToggle={rail.toggle} agentWorking={agentWorking} />
    {/* Hidden rather than unmounted while the script has the window: the player keeps playing
        what the script is about, and the agent keeps its conversation. */}
    <div className={cn('flex min-w-0 flex-1', focused && 'hidden')}>
    <Group
      orientation="vertical"
      defaultLayout={stageLayout.defaultLayout}
      onLayoutChanged={stageLayout.onLayoutChanged}
      className="min-w-0 flex-1"
    >
      <ResizablePanel id="stage" defaultSize="62" minSize="25">
        <div className="flex h-full min-h-0">
          {/* One panel at a time beside the stage. The agent stays mounted while it is shut, so
              its conversation — and a run still going — survive looking at something else. */}
          <div className={cn('flex h-full shrink-0', !rail.open && 'hidden')} style={{ width: sideWidth }}>
            <div className="min-w-0 flex-1">
              {rail.open && rail.open !== 'agent' && (
                <SidePanel title={RAIL_TITLES[rail.open]} onClose={rail.close}>
                  {rail.open === 'project' && project && (
                    <ProjectPanel
                      project={project}
                      totalFrames={computeTimelineDuration(remotionTimeline)}
                      clipCount={timeline.length}
                      narrated={progress.voiced}
                      hasContext={hasProjectContext(project.context)}
                      onEditContext={() => setEditingContext(true)}
                    />
                  )}
                  {rail.open === 'add' && (
                    <AddPanel
                      recording={recording}
                      importingDeck={importingDeck}
                      deckProgress={deckProgress}
                      isEmpty={timeline.length === 0}
                      importError={importError}
                      recordError={recordError}
                      onRecordSession={handleRecordSession}
                      onImportImage={handleImportImage}
                      onAddScene={() => setSceneEditing('new')}
                      onImportDeck={handleImportDeck}
                    />
                  )}
                  {rail.open === 'voice' && (
                    <VoicePanel
                      timeline={timeline}
                      progress={progress}
                      currentVoice={voice}
                      fidelityNote={fidelityNote}
                      onKeepProjectVoice={handleKeepProjectVoice}
                      projectVoice={project?.voice ?? null}
                      appVoice={appVoice}
                      voices={voices}
                      onProjectVoiceChange={(next) => void handleProjectVoiceChange(next)}
                    />
                  )}
                </SidePanel>
              )}
              <div className={cn('h-full', rail.open !== 'agent' && 'hidden')}>
                <AskTheAgent
                  projectId={projectId}
                  onClose={rail.close}
                  onWorkingChange={setAgentWorking}
                  onChanged={async () => {
                    // The agent wrote to the same files through a process of its own, so nothing the
                    // editor is holding can be trusted until it has been read back.
                    await refreshTimeline()
                    await refreshSegments()
                  }}
                />
              </div>
            </div>
            <ResizeHandle label="Resize the panel" side="left" width={sideWidth} onWidth={setSideWidth} />
          </div>
          <div className="flex h-full min-w-0 flex-1 flex-col">
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
                <div className="absolute inset-2 m-auto aspect-video max-h-full max-w-full overflow-hidden rounded-xl bg-[#0c0d11] shadow-2xl">
                  <Preview
                    ref={playerRef}
                    component={DemoComposition}
                    inputProps={{ timeline: remotionTimeline, theme: renderTheme ?? null }}
                    durationInFrames={computeTimelineDuration(remotionTimeline)}
                    fps={FPS}
                    width={WIDTH}
                    height={HEIGHT}
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
          <ResizeHandle label="Resize the inspector" side="right" width={inspectorWidth} onWidth={setInspectorWidth} />
          <div className="h-full shrink-0" style={{ width: inspectorWidth }}>
            <Inspector
              item={timeline.find((clip) => clip.id === selectedItemId) ?? null}
              timeline={timeline}
              segments={segments}
              progress={progress}
              themeName={renderTheme ? renderTheme.company || 'This project’s theme' : null}
              note={exampleVoiceNote({ example: project?.example, engine: appEngine, otherVoiceClips: progress.otherVoice.length })}
              playheadFrame={() => playerRef.current?.getCurrentFrame() ?? 0}
              busy={{ narrating: narratingItemId === selectedItemId, drafting: draftingItemId === selectedItemId }}
              onEdit={(item) => setSceneEditing(item)}
              onLook={handleLook}
              onNarrate={(item) => void handleNarrate(item)}
              onDraft={(item) => void handleDraft(item)}
              onSplit={(item, atFrame) => void handleSplit(item, atFrame)}
              onDelete={(item) => void handleDeleteClip(item)}
            />
          </div>
        </div>
      </ResizablePanel>
      <Separator className="h-2 bg-transparent transition-colors hover:bg-accent/30" />
      <ResizablePanel id="timeline" defaultSize="46" minSize="20">
        {!focused && workPane}
      </ResizablePanel>
    </Group>
    </div>
    {focused && (
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {timeline.length > 0 && (
          <TransportBar
            playerRef={playerRef}
            timeline={timeline}
            totalFrames={computeTimelineDuration(remotionTimeline)}
            onSeek={handleSeek}
          />
        )}
        <div className="min-h-0 flex-1">{workPane}</div>
      </div>
    )}
      {editingContext && project && (
        <AboutProjectDialog
          projectName={project.name}
          context={project.context ?? EMPTY_CONTEXT}
          themeId={project.themeId}
          onThemeChange={async (themeId) => {
            setProject(await projectClient.setTheme(projectId, themeId))
            // The first theme adds opening and closing cards, and every diagram is drawn anew.
            await refreshTimeline()
          }}
          onClose={() => setEditingContext(false)}
          onSave={async (context) => setProject(await projectClient.setContext(projectId, context))}
        />
      )}

      {sceneEditing && project && (
        <SceneEditor
          projectId={projectId}
          projectName={project.name}
          item={sceneEditing === 'new' ? null : sceneEditing}
          theme={renderTheme ?? null}
          onClose={() => setSceneEditing(null)}
          onSaved={async () => {
            await refreshTimeline()
            await refreshSegments()
          }}
        />
      )}
    </div>
  )
}
