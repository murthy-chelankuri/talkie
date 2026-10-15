import { useEffect, useRef } from 'react'
import { Film } from 'lucide-react'
import type { ProjectOverview } from '../api/projectClient'
import { FPS } from '../../../composition/constants'
import { cn } from '../lib/cn'

/**
 * The first frame of a project, wherever a project is shown.
 *
 * Shared by the launcher and the switcher so a project looks the same in both: recognising a
 * project by its picture is the whole point, and two versions of this would drift apart.
 */
export function ProjectPoster({
  project,
  className
}: {
  project: ProjectOverview
  className?: string
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const startSeconds = (project.posterTrimBefore ?? 0) / FPS

  useEffect(() => {
    const video = videoRef.current
    if (!video || startSeconds <= 0) return
    const seek = (): void => {
      video.currentTime = startSeconds
    }
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seek()
      return
    }
    video.addEventListener('loadedmetadata', seek, { once: true })
    return () => video.removeEventListener('loadedmetadata', seek)
  }, [startSeconds, project.posterPath])

  if (!project.posterPath) {
    return (
      <div className={cn('flex items-center justify-center bg-surface-hover text-text-muted', className)}>
        <Film size={16} aria-hidden="true" />
      </div>
    )
  }

  if (project.posterKind === 'video') {
    return (
      <video
        ref={videoRef}
        src={project.posterPath}
        muted
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        className={cn('object-cover', className)}
      />
    )
  }

  return <img src={project.posterPath} alt="" className={cn('object-cover', className)} />
}
