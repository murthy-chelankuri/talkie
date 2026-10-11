import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SyntheticEvent
} from 'react'
import type { PlayerRef } from '@remotion/player'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AudioLines,
  Film,
  Mic,
  Image as ImageIcon,
  LayoutTemplate,
  Redo2,
  Scissors,
  Share2,
  Sparkles,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { TimelineItem, TranscriptSegment } from '../api/projectClient'
import { cn } from '../lib/cn'
import { useRenderTheme } from '../../../remotion/renderTheme'
import { resolveSceneTheme } from '../../../remotion/sceneTheme'
import type { SceneStyle } from '../../../main/project/timeline/schema'
import { hasVisibleContent } from '../lib/frameContent'
import { chooseTickIntervalSeconds, formatTimecode, frameAtOffset, offsetAtFrame } from '../lib/timelineLayout'
import { FPS, NARRATION_LEAD_IN_FRAMES } from '../../../remotion/constants'
import { richTextToPlain } from '../../../main/project/timeline/richText'
import { RECORDED_VOICE, hasStaleVoice, segmentsForItem, voiceOf } from '../lib/clipNarration'
import { WAVEFORM_BUCKETS, useWaveform } from '../lib/waveform'
import { speakAllLabel, type VoiceProgress } from '../lib/voiceProgress'
import { IconButton } from './ui/IconButton'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import { ClipNarrationBox } from './ClipNarrationBox'

const DEFAULT_PIXELS_PER_SECOND = 60
const MIN_PIXELS_PER_SECOND = 10
const MAX_PIXELS_PER_SECOND = 400
const ZOOM_STEP = 1.5

// Narrower than this and a line of narration breaks one letter to a line, so the words are left
// out rather than shown unreadable.
const NARRATION_TEXT_MIN_WIDTH = 120

// Give up scanning for a non-blank frame after this much of the recording, so a genuinely
// blank capture settles on a frame instead of playing through to the end.
const THUMBNAIL_SCAN_LIMIT_SECONDS = 8

function VideoThumbnail({ src, startSeconds }: { src: string; startSeconds: number }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  function frameHasContent(video: HTMLVideoElement): boolean {
    const canvas = (canvasRef.current ??= document.createElement('canvas'))
    canvas.width = 32
    canvas.height = 18
    const context = canvas.getContext('2d')
    if (!context) return true

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    try {
      return hasVisibleContent(context.getImageData(0, 0, canvas.width, canvas.height).data)
    } catch {
      // Pixels unreadable, so there is nothing to scan for — keep whatever frame is showing.
      return true
    }
  }

  // Show the first frame this clip actually plays. Two clips split from one recording share a
  // file and differ only by where they start, so a thumbnail that ignored that would be the
  // same picture on both halves.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const show = (): void => {
      if (startSeconds > 0) {
        video.currentTime = startSeconds
        return
      }
      void video.play().catch(() => undefined)
    }

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      show()
      return
    }
    video.addEventListener('loadedmetadata', show, { once: true })
    return () => video.removeEventListener('loadedmetadata', show)
  }, [src, startSeconds])

  // A recording opens on the blank page from before the site painted, and a clip can start in a
  // similar gap, so when the frame we landed on has nothing in it, roll forward until one does.
  function handleSeeked(event: SyntheticEvent<HTMLVideoElement>): void {
    const video = event.currentTarget
    if (!video.paused) return
    if (!frameHasContent(video)) {
      void video.play().catch(() => undefined)
    }
  }

  function handleTimeUpdate(event: SyntheticEvent<HTMLVideoElement>): void {
    const video = event.currentTarget
    if (video.paused) return

    if (video.currentTime >= startSeconds + THUMBNAIL_SCAN_LIMIT_SECONDS) {
      video.pause()
      return
    }
    if (frameHasContent(video)) {
      video.pause()
    }
  }

  return (
    <video
      ref={videoRef}
      src={src}
      muted
      playsInline
      preload="auto"
      crossOrigin="anonymous"
      onSeeked={handleSeeked}
      onTimeUpdate={handleTimeUpdate}
      className="pointer-events-none h-full w-full object-cover"
    />
  )
}

export function ClipThumbnail({ item }: { item: TimelineItem }): JSX.Element | null {
  const data = item.data as
    | { src?: string; trimBefore?: number; title?: string; bullets?: string[]; style?: SceneStyle }
    | null
    | undefined
  // The same colours and type the slide is drawn in, so a thumbnail follows the project's theme
  // rather than showing every slide in the dark palette slides had before there were themes.
  const look = resolveSceneTheme(data?.style, useRenderTheme())

  // An HTML scene shows its poster — a still drawn by the check — once it has one.
  if (item.kind === 'html' && (data as { posterUrl?: string } | null)?.posterUrl) {
    return <img src={(data as { posterUrl: string }).posterUrl} alt="" className="pointer-events-none h-full w-full object-cover" />
  }

  // A slide has no picture to show, so it shows what it says.
  if (item.kind === 'scene' || item.kind === 'html') {
    return (
      <div
        // Bottom padding keeps the slide's own words clear of the kind chip in the corner.
        className="pointer-events-none flex h-full flex-col justify-center gap-1 overflow-hidden px-2.5 pb-5"
        style={{ background: look.background }}
      >
        {/* Strictly the words: a slide's text carries markup, and a label this small has no
            room to honour it — but every reason not to show the tags. */}
        <span
          className="truncate text-[13px] leading-tight"
          style={{ color: look.heading, fontFamily: look.headingFont }}
        >
          {richTextToPlain(data?.title ?? '') || 'Untitled slide'}
        </span>
        {(data?.bullets ?? []).length > 0 && (
          <span className="truncate text-[10px]" style={{ color: look.body, fontFamily: look.bodyFont }}>
            {(data?.bullets ?? []).map(richTextToPlain).join(' · ')}
          </span>
        )}
      </div>
    )
  }

  const src = data?.src
  if (!src) return null

  if (item.kind === 'video') {
    return <VideoThumbnail src={src} startSeconds={(data.trimBefore ?? 0) / FPS} />
  }

  // A diagram is not just a picture here, however much it looks like one: mermaid draws its
  // labels as HTML inside the SVG, and a browser will not render HTML in an image. Shown
  // through an `<img>` it came out as empty boxes, so it goes into the document instead —
  // which is what the player does with the same file.
  if (item.kind === 'diagram') {
    return <DiagramThumbnail src={src} background={look.background} />
  }

  return <img src={src} alt="" className="pointer-events-none h-full w-full object-cover" />
}

/** The diagram's own SVG, put in the document so the labels inside it draw. */
function DiagramThumbnail({ src, background }: { src: string; background: string }): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let wanted = true
    fetch(src)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((text) => {
        if (wanted) setSvg(text)
      })
      .catch(() => {
        // A drawing that cannot be read leaves the clip its background and its label, which is
        // still enough to find it by.
        if (wanted) setSvg(null)
      })
    return () => {
      wanted = false
    }
  }, [src])

  return (
    <span
      className="pointer-events-none block h-full w-full p-1 [&>svg]:h-full [&>svg]:w-full"
      style={{ background }}
      {...(svg ? { dangerouslySetInnerHTML: { __html: svg } } : {})}
    />
  )
}

/**
 * The voice actually attached to a clip.
 *
 * The picture and the script were both on the timeline, but the audio between them — the thing
 * that ends up in the video — was only ever a word in the corner of a text box. Which meant the
 * question this answers, "whose voice is on this clip", was the one thing the timeline would not
 * tell you. It is a layer of its own because that is what it is.
 */
export function VoiceLayer({
  item,
  segments,
  currentVoice,
  compact
}: {
  item: TimelineItem
  segments: TranscriptSegment[]
  currentVoice: string
  compact: boolean
}): JSX.Element {
  const segment = segmentsForItem(segments, item.id)[0]
  const narrated = segment?.status === 'narrated' && Boolean(segment.audioFile)
  const stale = hasStaleVoice(segments, item.id, currentVoice)
  const voice = voiceOf(segments, item.id)
  const own = voice === RECORDED_VOICE
  const hasWords = Boolean(segment?.text.trim())

  // Read only for a clip wide enough to draw it on, which also keeps a long project from
  // decoding fifty takes to show fifty slivers.
  const audioUrl = (item.data as { audioUrl?: string } | null | undefined)?.audioUrl
  const waveform = useWaveform(audioUrl, narrated && !compact)

  // Drawn where it actually plays: narration is held back a beat so the clip is seen before it
  // is spoken over, and a take shorter than its clip leaves the rest of the clip silent. A
  // waveform stretched over the whole band would claim otherwise.
  const clipSeconds = item.duration / FPS
  const startShare = NARRATION_LEAD_IN_FRAMES / FPS / clipSeconds
  const widthShare = waveform ? Math.min(waveform.seconds / clipSeconds, 1 - startShare) : 0

  const tone = !narrated
    ? 'border-dashed border-border bg-transparent text-text-muted'
    : stale
      ? 'border-accent/60 bg-accent/10 text-accent'
      : own
        ? 'border-accent/55 bg-accent/15 text-accent'
        : 'border-success/45 bg-success/10 text-success'

  const label = !narrated
    ? hasWords
      ? 'Written, not spoken'
      : 'No voice'
    : own
      ? 'Your voice'
      : stale
        ? `${voice} — voice has changed`
        : (voice ?? 'Voiced')

  return (
    <div
      title={label}
      className={cn(
        'relative flex h-full items-center overflow-hidden rounded border px-1.5 text-[10px]',
        tone
      )}
    >
      {/* The take itself, sitting where it plays. The bars are stretched to that span rather
          than redrawn at each zoom, so scrubbing and zooming cost nothing once it is read. */}
      {waveform && widthShare > 0 && (
        <svg
          viewBox={`0 0 ${WAVEFORM_BUCKETS} 20`}
          preserveAspectRatio="none"
          aria-hidden="true"
          // An explicit height, not top-and-bottom: an <svg> is a replaced element, so once a
          // width is given the height follows the viewBox ratio and `bottom` is ignored — which
          // drew a 200px waveform inside a 28px band.
          className="pointer-events-none absolute top-1 h-5 opacity-45"
          style={{ left: `${startShare * 100}%`, width: `${widthShare * 100}%` }}
        >
          {waveform.peaks.map((peak, index) => {
            // A floor, so silence between words is a mark on the line rather than a gap in it.
            const height = Math.max(1.5, peak * 20)
            return (
              <rect
                key={index}
                x={index + 0.15}
                y={(20 - height) / 2}
                width={0.7}
                height={height}
                rx={0.35}
                fill="currentColor"
              />
            )
          })}
        </svg>
      )}

      {/* Over the waveform rather than beside it, so the words stay readable and the picture
          keeps the whole width it is entitled to. */}
      <span className="relative flex items-center gap-1.5 rounded bg-surface/75 px-1 backdrop-blur-[1px]">
        {own ? (
          <Mic size={11} className="shrink-0" aria-hidden="true" />
        ) : (
          <AudioLines size={11} className="shrink-0" aria-hidden="true" />
        )}
        {!compact && <span className="truncate">{label}</span>}
      </span>
    </div>
  )
}

const CLIP_ICONS: Record<string, JSX.Element> = {
  video: <Film size={10} />,
  image: <ImageIcon size={10} />,
  scene: <LayoutTemplate size={10} />,
  diagram: <Share2 size={10} />
}

function ClipBlock({
  item,
  left,
  width,
  selected,
  onSelect,
  onEditScene
}: {
  item: TimelineItem
  left: number
  width: number
  selected: boolean
  onSelect: (item: TimelineItem) => void
  onEditScene: (item: TimelineItem) => void
}): JSX.Element {
  const isScene = item.kind === 'scene' || item.kind === 'diagram'
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={{
        left,
        width,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1
      }}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(item)}
      onDoubleClick={() => isScene && onEditScene(item)}
      title={isScene ? 'Double-click to edit this scene' : undefined}
      className={cn(
        // p-0 and an explicit hover colour are needed because Preflight's shim in index.css
        // gives every bare <button> hardcoded padding and a light grey hover background.
        'absolute top-0 h-full overflow-hidden rounded border bg-surface p-0 text-left text-sm text-text',
        'cursor-grab active:cursor-grabbing',
        selected ? 'border-accent ring-2 ring-accent' : 'border-border'
      )}
    >
      <ClipThumbnail item={item} />
      {/* Deliberately not themed: this label sits on arbitrary footage, so it needs a fixed
          dark scrim to stay legible in either theme. */}
      <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
        {CLIP_ICONS[item.kind] ?? <ImageIcon size={10} />}
        {item.kind === 'scene' ? 'slide' : item.kind}
      </span>
    </button>
  )
}

export function Timeline({
  timeline,
  segments,
  totalFrames,
  playerRef,
  selectedItemId,
  onSeek,
  onSelectItem,
  onReorder,
  onSplit,
  onActiveItemChange,
  narratingItemId,
  narratingAll,
  progress,
  currentVoice,
  onEditScene,
  recordingItemId,
  onRecord,
  onStopRecording,
  draftingItemId,
  draftingAll,
  onDraft,
  onDraftAll,
  onNarrationCommit,
  onNarrate,
  onNarrateAll,
  onDelete,
  canUndo,
  canRedo,
  onUndo,
  onRedo
}: {
  timeline: TimelineItem[]
  segments: TranscriptSegment[]
  totalFrames: number
  playerRef: RefObject<PlayerRef | null>
  selectedItemId: string | null
  onSeek: (frame: number) => void
  onSelectItem: (item: TimelineItem) => void
  onReorder: (orderedIds: string[]) => void
  onSplit: (item: TimelineItem, atFrame: number) => void
  onActiveItemChange: (itemId: string | null) => void
  narratingItemId: string | null
  narratingAll: boolean
  progress: VoiceProgress
  currentVoice: string
  /** Scenes are written in the app, so a click on one opens it rather than only selecting it. */
  onEditScene: (item: TimelineItem) => void
  recordingItemId: string | null
  onRecord: (item: TimelineItem) => void | Promise<void>
  onStopRecording: () => void | Promise<void>
  draftingItemId: string | null
  draftingAll: boolean
  onDraft: (item: TimelineItem) => void | Promise<void>
  onDraftAll: () => void | Promise<void>
  onNarrationCommit: (item: TimelineItem, text: string) => void | Promise<void>
  onNarrate: (item: TimelineItem) => void | Promise<void>
  onNarrateAll: () => void | Promise<void>
  onDelete: (item: TimelineItem) => void | Promise<void>
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void | Promise<void>
  onRedo: () => void | Promise<void>
}): JSX.Element {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND)
  // Whether the user has taken the zoom into their own hands. Until they do, the timeline fits
  // itself to the window.
  const zoomChosen = useRef(false)
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const trackAreaRef = useRef<HTMLDivElement | null>(null)
  const playheadRef = useRef<HTMLDivElement | null>(null)
  const rulerRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef(0)
  // Which clip the playhead is inside. This only changes at clip boundaries, so it is the one
  // piece of playback position worth putting in state — everything else is written to the DOM
  // directly, because re-rendering the whole timeline 30 times a second starved the Player of
  // the main thread and desynced its audio.
  const [itemUnderPlayheadId, setItemUnderPlayheadId] = useState<string | null>(null)
  // Removing a clip takes its narration with it and cannot be undone, so it asks first.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  /**
   * Fit the project to the width it has.
   *
   * At a fixed scale a short project sat in the left third of the timeline with the rest empty,
   * while a long one ran off the edge — in both cases the clips were the wrong size to work
   * with. Fitting means the timeline always shows the whole project, which is what it is for.
   * Touching the zoom hands control over and this stops.
   */
  useEffect(() => {
    const area = scrollAreaRef.current
    if (!area || zoomChosen.current || totalFrames === 0) return

    const fit = (): void => {
      if (zoomChosen.current) return
      const seconds = totalFrames / FPS
      // A little room at the end, so the last clip is not flush against the edge.
      const usable = area.clientWidth - 24
      if (seconds <= 0 || usable <= 0) return

      setPixelsPerSecond(
        Math.min(MAX_PIXELS_PER_SECOND, Math.max(MIN_PIXELS_PER_SECOND, usable / seconds))
      )
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(area)
    return () => observer.disconnect()
  }, [totalFrames])

  const contentWidth = offsetAtFrame(totalFrames, pixelsPerSecond, FPS)
  const tickSeconds = chooseTickIntervalSeconds(pixelsPerSecond)
  const tickCount = Math.floor(totalFrames / FPS / tickSeconds) + 1
  const itemUnderPlayhead = timeline.find((item) => item.id === itemUnderPlayheadId)

  useEffect(() => {
    setConfirmingDelete(false)
  }, [itemUnderPlayheadId])
  const splittable =
    itemUnderPlayhead && frameRef.current > itemUnderPlayhead.start ? itemUnderPlayhead : undefined

  const paintFrame = useCallback(
    (frame: number): void => {
      frameRef.current = frame
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${offsetAtFrame(frame, pixelsPerSecond, FPS)}px)`
      }
      // Written here rather than rendered, for the same reason as the playhead: the slider has
      // to report the live position without re-rendering the timeline on every frame.
      rulerRef.current?.setAttribute('aria-valuenow', String(frame))
      // A clip owns its first frame, so the playhead at 0 is already on the opening clip.
      // Splitting is stricter — see splittableItem — because a cut at a clip's own edge would
      // leave an empty half.
      const containing = timeline.find(
        (item) => frame >= item.start && frame < item.start + item.duration
      )
      setItemUnderPlayheadId((previous) => {
        const next = containing?.id ?? null
        if (previous === next) return previous
        onActiveItemChange(next)
        return next
      })
    },
    [pixelsPerSecond, timeline, totalFrames, onActiveItemChange]
  )

  useEffect(() => {
    paintFrame(frameRef.current)
  }, [paintFrame])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    const onFrameUpdate = ({ detail }: { detail: { frame: number } }): void => paintFrame(detail.frame)
    player.addEventListener('frameupdate', onFrameUpdate)
    return () => player.removeEventListener('frameupdate', onFrameUpdate)
  }, [playerRef, paintFrame])

  function seekFromPointer(event: ReactPointerEvent<HTMLElement>): void {
    const area = trackAreaRef.current
    if (!area) return
    const offset = event.clientX - area.getBoundingClientRect().left
    const frame = frameAtOffset(offset, pixelsPerSecond, FPS, totalFrames)
    paintFrame(frame)
    onSeek(frame)
  }

  function handleScrubStart(event: ReactPointerEvent<HTMLElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId)
    seekFromPointer(event)
  }

  function handleScrubMove(event: ReactPointerEvent<HTMLElement>): void {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    seekFromPointer(event)
  }

  function handleScrubEnd(event: ReactPointerEvent<HTMLElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = timeline.findIndex((item) => item.id === active.id)
    const newIndex = timeline.findIndex((item) => item.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(arrayMove(timeline, oldIndex, newIndex).map((item) => item.id))
  }

  /**
   * A timeline with nothing on it.
   *
   * It was a blank field taking up half the window, under a toolbar of controls that were all
   * disabled because there was nothing to use them on — the emptiest possible answer to someone
   * opening their first project. Saying what the space is for costs nothing and is the one
   * moment it can be explained.
   */
  if (timeline.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 border-t border-border bg-surface text-center">
        <LayoutTemplate size={22} className="text-text-muted/60" aria-hidden="true" />
        <p className="text-sm text-text">Your clips will line up here</p>
        <p className="max-w-sm text-xs leading-relaxed text-text-muted">
          Record a session, drop in an image or write a slide, and it lands on this strip. Drag to
          reorder, and give each clip its words underneath.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col border-t border-border bg-surface">
      {/* No timecode and no clip count here: the transport bar shows the first a few pixels
          above, and the project summary shows the second. Saying either again only crowds the
          actions, which are what this row is for. */}
      <div className="flex items-center gap-3 border-b border-border px-3 py-2">
        {confirmingDelete && itemUnderPlayhead ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-text-muted">
              Remove this {itemUnderPlayhead.kind} clip and its narration?
            </span>
            <Button
              size="sm"
              className="bg-danger text-white hover:bg-danger"
              onClick={() => {
                setConfirmingDelete(false)
                onDelete(itemUnderPlayhead)
              }}
            >
              Remove
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
              Keep
            </Button>
          </div>
        ) : (
        <div className="ml-auto flex items-center gap-1">
          {/* The two steps, named for what they produce rather than for the verb behind them,
              and carrying the same icons as the buttons on each clip. */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onDraftAll}
            disabled={draftingAll || timeline.length === 0}
            title="Write narration for every clip that has none. Words you wrote are left alone."
          >
            {draftingAll ? <Spinner size="sm" /> : <Sparkles size={14} className="text-accent" />}
            Write the words
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onNarrateAll}
            disabled={narratingAll || progress.needing.length === 0}
            title={
              progress.needing.length === 0
                ? `Every clip already speaks in ${currentVoice}`
                : progress.silent.length > 0
                  ? 'Speak the narration on every clip that has none'
                  : `Read these again in ${currentVoice}, replacing the takes already there`
            }
          >
            {narratingAll ? <Spinner size="sm" /> : <AudioLines size={14} className="text-accent" />}
            {speakAllLabel(progress, currentVoice)}
          </Button>
          <IconButton aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
            <Redo2 size={16} />
          </IconButton>
          <IconButton
            aria-label="Remove clip at playhead"
            disabled={!itemUnderPlayhead}
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 size={16} />
          </IconButton>
          <IconButton
            aria-label="Split clip at playhead"
            disabled={!splittable}
            onClick={() => splittable && onSplit(splittable, frameRef.current)}
          >
            <Scissors size={16} />
          </IconButton>
          <IconButton
            aria-label="Zoom out"
            disabled={pixelsPerSecond <= MIN_PIXELS_PER_SECOND}
            onClick={() => {
              zoomChosen.current = true
              setPixelsPerSecond((pps) => Math.max(MIN_PIXELS_PER_SECOND, pps / ZOOM_STEP))
            }}
          >
            <ZoomOut size={16} />
          </IconButton>
          <IconButton
            aria-label="Zoom in"
            disabled={pixelsPerSecond >= MAX_PIXELS_PER_SECOND}
            onClick={() => {
              zoomChosen.current = true
              setPixelsPerSecond((pps) => Math.min(MAX_PIXELS_PER_SECOND, pps * ZOOM_STEP))
            }}
          >
            <ZoomIn size={16} />
          </IconButton>
        </div>
        )}
      </div>

      <div ref={scrollAreaRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div ref={trackAreaRef} className="relative h-full" style={{ width: Math.max(contentWidth, 1) }}>
          <div
            ref={rulerRef}
            role="slider"
            tabIndex={0}
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={Math.max(totalFrames - 1, 0)}
            aria-valuenow={0}
            onPointerDown={handleScrubStart}
            onPointerMove={handleScrubMove}
            onPointerUp={handleScrubEnd}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') onSeek(Math.max(0, frameRef.current - 1))
              if (event.key === 'ArrowRight') onSeek(Math.min(totalFrames - 1, frameRef.current + 1))
            }}
            className="relative h-7 cursor-ew-resize select-none border-b border-border"
          >
            {Array.from({ length: tickCount }, (_, index) => {
              const seconds = index * tickSeconds
              return (
                <span
                  key={seconds}
                  style={{ left: seconds * pixelsPerSecond }}
                  className="absolute top-0 h-full border-l border-border pl-1 text-[10px] leading-7 tabular-nums text-text-muted"
                >
                  {formatTimecode(seconds)}
                </span>
              )
            })}
          </div>

          <div className="relative mx-0 mt-2 h-20">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={timeline.map((item) => item.id)} strategy={horizontalListSortingStrategy}>
                {timeline.map((item) => (
                  <ClipBlock
                    key={item.id}
                    item={item}
                    left={offsetAtFrame(item.start, pixelsPerSecond, FPS)}
                    width={offsetAtFrame(item.duration, pixelsPerSecond, FPS)}
                    onEditScene={onEditScene}
                    selected={item.id === selectedItemId}
                    onSelect={onSelectItem}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>

          {/* Between the picture and the script, because that is where the audio sits. */}
          <div className="relative mt-1.5 h-7">
            {timeline.map((item) => (
              <div
                key={item.id}
                style={{
                  left: offsetAtFrame(item.start, pixelsPerSecond, FPS),
                  width: offsetAtFrame(item.duration, pixelsPerSecond, FPS)
                }}
                className="absolute top-0 h-full pr-1"
              >
                <VoiceLayer
                  item={item}
                  segments={segments}
                  currentVoice={currentVoice}
                  compact={
                    offsetAtFrame(item.duration, pixelsPerSecond, FPS) < NARRATION_TEXT_MIN_WIDTH
                  }
                />
              </div>
            ))}
          </div>

          <div className="relative mt-2 h-36">
            {timeline.map((item) => (
              <div
                key={item.id}
                style={{
                  left: offsetAtFrame(item.start, pixelsPerSecond, FPS),
                  width: offsetAtFrame(item.duration, pixelsPerSecond, FPS)
                }}
                className="absolute top-0 h-full pr-1"
              >
                <ClipNarrationBox
                  item={item}
                  segments={segments}
                  compact={offsetAtFrame(item.duration, pixelsPerSecond, FPS) < NARRATION_TEXT_MIN_WIDTH}
                  active={item.id === itemUnderPlayheadId}
                  narrating={narratingItemId === item.id}
                  currentVoice={currentVoice}
                  recording={recordingItemId === item.id}
                  onRecord={onRecord}
                  onStopRecording={onStopRecording}
                  drafting={draftingAll || draftingItemId === item.id}
                  onDraft={onDraft}
                  onCommit={onNarrationCommit}
                  onNarrate={onNarrate}
                />
              </div>
            ))}
          </div>

          {totalFrames > 0 && (
            <div
              ref={playheadRef}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 left-0 z-10 w-px bg-danger"
            >
              <div className="-ml-[5px] h-2.5 w-2.5 rotate-45 rounded-[2px] bg-danger" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
