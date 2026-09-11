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
import { Mic, Scissors, ZoomIn, ZoomOut } from 'lucide-react'
import type { TimelineItem, TranscriptSegment } from '../api/projectClient'
import { cn } from '../lib/cn'
import { hasVisibleContent } from '../lib/frameContent'
import { chooseTickIntervalSeconds, formatTimecode, frameAtOffset, offsetAtFrame } from '../lib/timelineLayout'
import { FPS } from '../../../remotion/constants'
import { IconButton } from './ui/IconButton'

const DEFAULT_PIXELS_PER_SECOND = 60
const MIN_PIXELS_PER_SECOND = 10
const MAX_PIXELS_PER_SECOND = 400
const ZOOM_STEP = 1.5

// Give up scanning for a non-blank frame after this much of the recording, so a genuinely
// blank capture settles on a frame instead of playing through to the end.
const THUMBNAIL_SCAN_LIMIT_SECONDS = 8

function VideoThumbnail({ src }: { src: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Recordings open on the blank page from before the site painted, so play muted until a frame
  // actually has content and hold it there.
  function handleTimeUpdate(event: SyntheticEvent<HTMLVideoElement>): void {
    const video = event.currentTarget
    if (video.paused) return

    if (video.currentTime >= THUMBNAIL_SCAN_LIMIT_SECONDS) {
      video.pause()
      return
    }

    const canvas = (canvasRef.current ??= document.createElement('canvas'))
    canvas.width = 32
    canvas.height = 18
    const context = canvas.getContext('2d')
    if (!context) return

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    try {
      if (hasVisibleContent(context.getImageData(0, 0, canvas.width, canvas.height).data)) {
        video.pause()
      }
    } catch {
      video.pause()
    }
  }

  return (
    <video
      src={src}
      muted
      playsInline
      autoPlay
      preload="auto"
      crossOrigin="anonymous"
      onTimeUpdate={handleTimeUpdate}
      className="pointer-events-none h-full w-full object-cover"
    />
  )
}

function ClipThumbnail({ item }: { item: TimelineItem }): JSX.Element | null {
  const src = (item.data as { src?: string } | null | undefined)?.src
  if (!src) return null

  if (item.kind === 'video') {
    return <VideoThumbnail src={src} />
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
        'absolute top-0 h-full overflow-hidden rounded-md border bg-surface p-0 text-left text-sm text-text',
        'cursor-grab active:cursor-grabbing',
        selected ? 'border-accent ring-2 ring-accent' : 'border-border'
      )}
    >
      <ClipThumbnail item={item} />
      {/* Deliberately not themed: this label sits on arbitrary footage, so it needs a fixed
          dark scrim to stay legible in either theme. */}
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-xs text-white">{item.kind}</span>
    </button>
  )
}

function SegmentBlock({
  segment,
  left,
  width,
  selected,
  active,
  onSelect
}: {
  segment: TranscriptSegment
  left: number
  width: number
  selected: boolean
  active: boolean
  onSelect: (segment: TranscriptSegment) => void
}): JSX.Element {
  return (
    <button
      type="button"
      style={{ left, width }}
      onClick={() => onSelect(segment)}
      title={segment.text}
      className={cn(
        'absolute top-0 flex h-full items-center gap-1 overflow-hidden rounded-md border px-2 py-0 text-left text-xs',
        active ? 'bg-accent text-accent-foreground' : 'bg-surface text-text hover:bg-surface-hover',
        selected ? 'border-accent ring-2 ring-accent' : 'border-border'
      )}
    >
      {segment.status === 'narrated' && <Mic size={11} aria-hidden="true" className="shrink-0" />}
      <span className="truncate">{segment.text}</span>
    </button>
  )
}

export function Timeline({
  timeline,
  segments,
  totalFrames,
  playerRef,
  selectedItemId,
  selectedSegmentId,
  onSeek,
  onSelectItem,
  onSelectSegment,
  onReorder,
  onSplit,
  onActiveItemChange
}: {
  timeline: TimelineItem[]
  segments: TranscriptSegment[]
  totalFrames: number
  playerRef: RefObject<PlayerRef | null>
  selectedItemId: string | null
  selectedSegmentId: string | null
  onSeek: (frame: number) => void
  onSelectItem: (item: TimelineItem) => void
  onSelectSegment: (segment: TranscriptSegment) => void
  onReorder: (orderedIds: string[]) => void
  onSplit: (item: TimelineItem, atFrame: number) => void
  onActiveItemChange: (itemId: string | null) => void
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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const contentWidth = offsetAtFrame(totalFrames, pixelsPerSecond, FPS)
  const tickSeconds = chooseTickIntervalSeconds(pixelsPerSecond)
  const tickCount = Math.floor(totalFrames / FPS / tickSeconds) + 1
  const itemUnderPlayhead = timeline.find((item) => item.id === itemUnderPlayheadId)
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

  // Segments sharing a clip split its width between them, so blocks never sit on top of
  // each other when one clip has been narrated more than once.
  const segmentPlacements = segments.flatMap((segment) => {
    const item = timeline.find((candidate) => candidate.id === segment.timelineItemId)
    if (!item) return []
    const siblings = segments.filter((candidate) => candidate.timelineItemId === segment.timelineItemId)
    const indexInItem = siblings.findIndex((candidate) => candidate.id === segment.id)
    const itemLeft = offsetAtFrame(item.start, pixelsPerSecond, FPS)
    const itemWidth = offsetAtFrame(item.duration, pixelsPerSecond, FPS)
    const width = itemWidth / siblings.length
    return [
      {
        segment,
        left: itemLeft + width * indexInItem,
        width,
        active: item.id === itemUnderPlayheadId
      }
    ]
  })

  return (
    <div className="flex h-56 flex-col border-t border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-text-muted">Timeline</span>
        <span ref={timecodeRef} className="text-xs text-text-muted">
          {formatTimecode(0)} / {formatTimecode(totalFrames / FPS)}
        </span>
        <div className="ml-auto flex items-center gap-1">
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
                  className="absolute top-0 h-full border-l border-border pl-1 text-[10px] leading-7 text-text-muted"
                >
                  {formatTimecode(seconds)}
                </span>
              )
            })}
          </div>

          <div className="relative mx-0 mt-2 h-24">
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

          <div className="relative mt-2 h-8">
            {segmentPlacements.map(({ segment, left, width, active }) => (
              <SegmentBlock
                key={segment.id}
                segment={segment}
                left={left}
                width={width}
                active={active}
                selected={segment.id === selectedSegmentId}
                onSelect={onSelectSegment}
              />
            ))}
          </div>

          {totalFrames > 0 && (
            <div
              ref={playheadRef}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 left-0 z-10 w-px bg-danger"
            >
              <div className="-ml-1.5 h-2 w-3 rounded-b bg-danger" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
