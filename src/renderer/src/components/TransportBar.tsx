import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { PreviewHandle } from '../../../video/preview'
import { Check, Copy, Maximize2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import type { TimelineItem } from '../api/projectClient'
import { formatPreciseTimecode, formatSceneSeconds, formatTimecode, nextClipStart, previousClipStart, sceneAt } from '../lib/timelineLayout'
import { FPS } from '../../../composition/constants'
import { cn } from '../lib/cn'
import { IconButton } from './ui/IconButton'

export function TransportBar({
  playerRef,
  timeline,
  sceneOrder,
  totalFrames,
  onSeek
}: {
  playerRef: RefObject<PreviewHandle | null>
  timeline: TimelineItem[]
  /** Every clip's id as the script numbers them, left-out ones included, so "Scene 3" is one scene everywhere. */
  sceneOrder: string[]
  totalFrames: number
  onSeek: (frame: number) => void
}): JSX.Element {
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const frameRef = useRef(0)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const fillRef = useRef<HTMLDivElement | null>(null)
  const timecodeRef = useRef<HTMLSpanElement | null>(null)
  const sceneNameRef = useRef<HTMLSpanElement | null>(null)
  const sceneTimeRef = useRef<HTMLSpanElement | null>(null)
  const sceneFillRef = useRef<HTMLSpanElement | null>(null)
  const timelineRef = useRef(timeline)
  timelineRef.current = timeline
  const sceneOrderRef = useRef(sceneOrder)
  sceneOrderRef.current = sceneOrder
  const [copied, setCopied] = useState(false)

  // The scene clock is painted the same way as the timecode, and from the same frames.
  function paintScene(frame: number): void {
    const scene = sceneAt(timelineRef.current, frame)
    if (sceneNameRef.current) {
      sceneNameRef.current.textContent = scene ? `Scene ${sceneOrderRef.current.indexOf(scene.clip.id) + 1}` : 'No scene'
    }
    if (sceneTimeRef.current) {
      sceneTimeRef.current.textContent = scene
        ? `${formatSceneSeconds(scene.offset / FPS)}s of ${formatSceneSeconds(scene.duration / FPS)}s`
        : ''
    }
    if (sceneFillRef.current) {
      sceneFillRef.current.style.transform = `scaleX(${scene ? Math.min(scene.offset / scene.duration, 1) : 0})`
    }
  }


  // Playback position is written straight to the DOM. Putting it in state would re-render this
  // bar thirty times a second and starve the Player, which is what made narration stutter before.
  useEffect(() => {
    const player = playerRef.current
    if (!player) return

    const paint = (frame: number): void => {
      frameRef.current = frame
      const progress = totalFrames > 0 ? Math.min(frame / totalFrames, 1) : 0
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${progress})`
      if (timecodeRef.current) timecodeRef.current.textContent = formatPreciseTimecode(frame / FPS)
      paintScene(frame)
    }

    const onFrame = ({ detail }: { detail: { frame: number } }): void => paint(detail.frame)
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)

    paint(player.getCurrentFrame())
    setPlaying(player.isPlaying())
    setMuted(player.isMuted())

    player.addEventListener('frameupdate', onFrame)
    player.addEventListener('play', onPlay)
    player.addEventListener('pause', onPause)
    return () => {
      player.removeEventListener('frameupdate', onFrame)
      player.removeEventListener('play', onPlay)
      player.removeEventListener('pause', onPause)
    }
  }, [playerRef, totalFrames])

  // A scene lengthened, moved or left out changes where the playhead stands in it, playing or not.
  useEffect(() => paintScene(frameRef.current), [timeline, sceneOrder])

  function seekFromPointer(event: ReactPointerEvent<HTMLDivElement>): void {
    const track = trackRef.current
    if (!track || totalFrames <= 0) return
    const { left, width } = track.getBoundingClientRect()
    const ratio = Math.min(Math.max((event.clientX - left) / width, 0), 1)
    onSeek(Math.min(Math.round(ratio * totalFrames), totalFrames - 1))
  }

  const skipBack = previousClipStart(timeline, frameRef.current)
  const skipForward = nextClipStart(timeline, frameRef.current)

  return (
    // A pill floating under the picture rather than a bar across the window: the controls belong
    // to the video, and the video is the brightest thing on screen.
    <div className="mx-auto mb-2 mt-1.5 flex w-full max-w-3xl items-center gap-3 rounded-full bg-surface px-2 py-1.5 shadow-lg">
      <IconButton
        aria-label={playing ? 'Pause' : 'Play'}
        className="h-8 w-8 rounded-full bg-accent-fill text-on-accent hover:bg-accent-fill hover:text-on-accent hover:brightness-110"
        onClick={() => playerRef.current?.toggle()}
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </IconButton>

      <IconButton
        aria-label="Previous clip"
        disabled={skipBack === null}
        onClick={() => skipBack !== null && onSeek(skipBack)}
      >
        <SkipBack size={15} />
      </IconButton>
      <IconButton
        aria-label="Next clip"
        disabled={skipForward === null}
        onClick={() => skipForward !== null && onSeek(skipForward)}
      >
        <SkipForward size={15} />
      </IconButton>

      {/* Tenths here too: in whole seconds the video read 0:02 beside a scene at 2.9, and the two
          clocks looked as if they disagreed about the same moment. */}
      <span aria-label="Time in the video" className="flex shrink-0 items-baseline gap-1 text-xs tabular-nums text-text-muted">
        <span ref={timecodeRef} className="text-text">
          {formatPreciseTimecode(0)}
        </span>{' '}
        <span>/ {formatTimecode(totalFrames / FPS)}</span>
      </span>

      {/* The scene's own clock, boxed apart from the video's with a bar of its own, so it reads as
          the time inside one scene — where narration timings count from — not a second reading of
          the video's. */}
      <span
        title="Time inside the scene being played. A narration timing like [2.9] counts from the start of its scene."
        className="relative flex shrink-0 items-center gap-1.5 overflow-hidden rounded-md bg-raised py-0.5 pl-2 pr-0.5"
      >
        <span role="group" aria-label="Time in this scene" className="flex items-baseline gap-1.5 text-xs tabular-nums">
          <span ref={sceneNameRef} className="text-[11px] font-medium text-accent">
            No scene
          </span>{' '}
          <span ref={sceneTimeRef} className="text-text" />
        </span>
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-surface">
          <span ref={sceneFillRef} className="block h-full w-full origin-left scale-x-0 bg-accent" />
        </span>
        <IconButton
          aria-label={copied ? 'Copied' : 'Copy this moment as a narration timing'}
          title="Copy this moment as a timing, to paste at the start of a narration line"
          className="h-6 w-6"
          onClick={() => {
            const scene = sceneAt(timelineRef.current, frameRef.current)
            if (!scene) return
            void navigator.clipboard.writeText(`[${formatSceneSeconds(scene.offset / FPS)}] `).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </IconButton>
      </span>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.max(totalFrames - 1, 0)}
        aria-valuenow={frameRef.current}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          seekFromPointer(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event)
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        className={cn(
          'group relative h-6 min-w-0 flex-1 cursor-pointer select-none',
          'flex items-center'
        )}
      >
        <span className="h-1 w-full overflow-hidden rounded-full bg-raised">
          <span
            ref={fillRef}
            className="block h-full w-full origin-left scale-x-0 rounded-full bg-accent-fill"
          />
        </span>
      </div>

      <IconButton
        aria-label={muted ? 'Unmute' : 'Mute'}
        onClick={() => {
          const player = playerRef.current
          if (!player) return
          if (player.isMuted()) player.unmute()
          else player.mute()
          setMuted(player.isMuted())
        }}
      >
        {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </IconButton>
      <IconButton aria-label="Fullscreen" onClick={() => playerRef.current?.requestFullscreen()}>
        <Maximize2 size={15} />
      </IconButton>
    </div>
  )
}
