import { useMemo, useRef, type RefObject } from 'react'
import type { PreviewHandle } from '../../../video/preview'
import { toEditFrame, toPlayFrame } from '../../../main/project/versions'

type Clip = { id: string; start: number; duration: number }
type AnyListener = (event: { detail: unknown }) => void

/**
 * The player as the timeline sees it, when a version leaves scenes out.
 *
 * The player plays only the scenes the version keeps, so its frames are the shorter video's. The
 * timeline, the script and the inspector still show every scene, left-out ones dimmed in place,
 * and count frames along the whole timeline. This stands between them: frames read or reported
 * are mapped onto the whole timeline, and a seek to a point on it goes to the same moment of the
 * video — or, inside a left-out scene, to where the next scene played starts. Nothing reading it
 * needs to know a version exists. The transport bar alone uses the player as it is, since its
 * length is the video's.
 */
export function useEditPlayer(player: RefObject<PreviewHandle>, timeline: Clip[], leftOut: readonly string[]): RefObject<PreviewHandle> {
  const cut = useRef({ timeline, leftOut })
  cut.current = { timeline, leftOut }
  // The same wrapped listener for the same listener, so removing one finds what was added.
  const wrapped = useRef(new Map<AnyListener, AnyListener>())

  return useMemo(() => {
    const toEdit = (frame: number): number => toEditFrame(cut.current.timeline, cut.current.leftOut, frame)
    const toPlay = (frame: number): number => toPlayFrame(cut.current.timeline, cut.current.leftOut, frame)
    const wrap = (listener: AnyListener): AnyListener => {
      let mapped = wrapped.current.get(listener)
      if (!mapped) {
        mapped = (event) => {
          const detail = event.detail as { frame?: number } | undefined
          listener(typeof detail?.frame === 'number' ? { detail: { ...detail, frame: toEdit(detail.frame) } } : event)
        }
        wrapped.current.set(listener, mapped)
      }
      return mapped
    }
    return {
      get current(): PreviewHandle | null {
        const inner = player.current
        if (!inner) return null
        return {
          ...inner,
          seekTo: (frame: number) => inner.seekTo(toPlay(frame)),
          getCurrentFrame: () => toEdit(inner.getCurrentFrame()),
          addEventListener: (event, listener) => inner.addEventListener(event, wrap(listener as AnyListener) as never),
          removeEventListener: (event, listener) => {
            const mapped = wrapped.current.get(listener as AnyListener)
            if (mapped) inner.removeEventListener(event, mapped as never)
          }
        }
      }
    }
  }, [player])
}
