import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { PlayerRef } from '@remotion/player'
import { Maximize2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import type { TimelineItem } from '../api/projectClient'
import { formatTimecode, nextClipStart, previousClipStart } from '../lib/timelineLayout'
import { FPS } from '../../../remotion/constants'
import { cn } from '../lib/cn'
import { IconButton } from './ui/IconButton'

export function TransportBar({
  playerRef,
  timeline,
  totalFrames,
  onSeek
}: {
  playerRef: RefObject<PlayerRef | null>
  timeline: TimelineItem[]
  totalFrames: number
  onSeek: (frame: number) => void
}): JSX.Element {
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const frameRef = useRef(0)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const fillRef = useRef<HTMLDivElement | null>(null)
  const timecodeRef = useRef<HTMLSpanElement | null>(null)

  // Playback position is written straight to the DOM. Putting it in state would re-render this
  // bar thirty times a second and starve the Player, which is what made narration stutter before.
  useEffect(() => {
    const player = playerRef.current
    if (!player) return

    const paint = (frame: number): void => {
      frameRef.current = frame
      const progress = totalFrames > 0 ? Math.min(frame / totalFrames, 1) : 0
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${progress})`
      if (timecodeRef.current) timecodeRef.current.textContent = formatTimecode(frame / FPS)
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
    <div className="flex items-center gap-3 border-t border-border bg-surface px-3 py-2">
      <IconButton
        aria-label={playing ? 'Pause' : 'Play'}
        className="h-8 w-8 bg-accent text-accent-foreground hover:bg-accent-hover hover:text-accent-foreground"
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

      <span className="flex shrink-0 items-baseline gap-1 text-xs tabular-nums text-text-muted">
        <span ref={timecodeRef} className="text-text">
          {formatTimecode(0)}
        </span>
        <span>/ {formatTimecode(totalFrames / FPS)}</span>
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
        <span className="h-1 w-full overflow-hidden rounded-full bg-border">
          <span
            ref={fillRef}
            className="block h-full w-full origin-left scale-x-0 rounded-full bg-accent"
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
