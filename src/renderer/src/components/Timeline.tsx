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
import { Film, Image as ImageIcon, Redo2, Scissors, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import type { TimelineItem, TranscriptSegment } from '../api/projectClient'
import { cn } from '../lib/cn'
import { hasVisibleContent } from '../lib/frameContent'
import { chooseTickIntervalSeconds, formatTimecode, frameAtOffset, offsetAtFrame } from '../lib/timelineLayout'
import { FPS } from '../../../remotion/constants'
import { IconButton } from './ui/IconButton'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import { ClipNarrationBox } from './ClipNarrationBox'

const DEFAULT_PIXELS_PER_SECOND = 60
const MIN_PIXELS_PER_SECOND = 10
const MAX_PIXELS_PER_SECOND = 400
const ZOOM_STEP = 1.5

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

function ClipThumbnail({ item }: { item: TimelineItem }): JSX.Element | null {
  const data = item.data as { src?: string; trimBefore?: number } | null | undefined
  const src = data?.src
  if (!src) return null

  if (item.kind === 'video') {
    return <VideoThumbnail src={src} startSeconds={(data.trimBefore ?? 0) / FPS} />
  }

  return <img src={src} alt="" className="pointer-events-none h-full w-full object-cover" />
}

function ClipBlock({
  item,
  left,
  width,
  selected,
  onSelect
}: {
  item: TimelineItem
  left: number
  width: number
  selected: boolean
  onSelect: (item: TimelineItem) => void
}): JSX.Element {
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
        {item.kind === 'video' ? <Film size={10} /> : <ImageIcon size={10} />}
        {item.kind}
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
  needingNarration,
  currentVoice,
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
  needingNarration: number
  currentVoice: string
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
  const trackAreaRef = useRef<HTMLDivElement | null>(null)
  const playheadRef = useRef<HTMLDivElement | null>(null)
  const timecodeRef = useRef<HTMLSpanElement | null>(null)
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
      if (timecodeRef.current) {
        timecodeRef.current.textContent = `${formatTimecode(frame / FPS)} / ${formatTimecode(totalFrames / FPS)}`
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

  return (
    <div className="flex h-full flex-col border-t border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2">
        <span ref={timecodeRef} className="text-sm tabular-nums text-text">
          {formatTimecode(0)} / {formatTimecode(totalFrames / FPS)}
        </span>
        <span className="text-xs text-text-muted">
          {timeline.length} clip{timeline.length === 1 ? '' : 's'}
        </span>
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
          <Button
            variant="secondary"
            size="sm"
            onClick={onDraftAll}
            disabled={draftingAll || timeline.length === 0}
          >
            {draftingAll ? <Spinner size="sm" /> : 'Draft all'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onNarrateAll}
            disabled={narratingAll || needingNarration === 0}
          >
            {narratingAll ? <Spinner size="sm" /> : `Narrate all (${needingNarration})`}
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
            onClick={() => setPixelsPerSecond((pps) => Math.max(MIN_PIXELS_PER_SECOND, pps / ZOOM_STEP))}
          >
            <ZoomOut size={16} />
          </IconButton>
          <IconButton
            aria-label="Zoom in"
            disabled={pixelsPerSecond >= MAX_PIXELS_PER_SECOND}
            onClick={() => setPixelsPerSecond((pps) => Math.min(MAX_PIXELS_PER_SECOND, pps * ZOOM_STEP))}
          >
            <ZoomIn size={16} />
          </IconButton>
        </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
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
                    selected={item.id === selectedItemId}
                    onSelect={onSelectItem}
                  />
                ))}
              </SortableContext>
            </DndContext>
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
                  active={item.id === itemUnderPlayheadId}
                  narrating={narratingItemId === item.id}
                  currentVoice={currentVoice}
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
