import { forwardRef, useImperativeHandle, useRef, type ComponentType, type CSSProperties, type ForwardedRef, type Ref } from 'react'
import { Player, type PlayerRef } from '@remotion/player'

/**
 * The editor's player: the stage, the HTML scene panel and the theme preview. Its handle and
 * events are exactly what the transport bar, the timeline and the script already use, so that
 * when step 4 of the renderer replaces what is inside, none of them change.
 */

export type PreviewEvents = { frameupdate: { frame: number }; play: undefined; pause: undefined }
type Listener<E extends keyof PreviewEvents> = (event: { detail: PreviewEvents[E] }) => void

export interface PreviewHandle {
  seekTo(frame: number): void
  getCurrentFrame(): number
  toggle(): void
  isPlaying(): boolean
  mute(): void
  unmute(): void
  isMuted(): boolean
  requestFullscreen(): void
  addEventListener<E extends keyof PreviewEvents>(event: E, listener: Listener<E>): void
  removeEventListener<E extends keyof PreviewEvents>(event: E, listener: Listener<E>): void
}

export type PreviewProps<P extends object> = {
  component: ComponentType<P>
  inputProps: P
  durationInFrames: number
  fps: number
  /**
   * The composition's size, not the element's. The picture is drawn at this size and scaled to
   * fit `style`; scenes rely on that (fixed pixel font sizes, HtmlScene's 1920-wide frame).
   */
  width: number
  height: number
  /** The player's own controls, for panels without the editor's transport bar. */
  controls?: boolean
  loop?: boolean
  autoPlay?: boolean
  style?: CSSProperties
}

function PreviewWith<P extends object>(
  { component, inputProps, durationInFrames, fps, width, height, controls, loop, autoPlay, style }: PreviewProps<P>,
  ref: ForwardedRef<PreviewHandle>
): JSX.Element {
  const player = useRef<PlayerRef>(null)

  // Delegates call by call rather than handing out Remotion's own handle, so the editor cannot
  // come to rely on anything the replacement will not have.
  useImperativeHandle(
    ref,
    () => ({
      seekTo: (frame) => player.current?.seekTo(frame),
      getCurrentFrame: () => player.current?.getCurrentFrame() ?? 0,
      toggle: () => player.current?.toggle(),
      isPlaying: () => player.current?.isPlaying() ?? false,
      mute: () => player.current?.mute(),
      unmute: () => player.current?.unmute(),
      isMuted: () => player.current?.isMuted() ?? false,
      requestFullscreen: () => player.current?.requestFullscreen(),
      // Remotion's emitter is typed per event; ours are the same names and payloads.
      addEventListener: (event, listener) => player.current?.addEventListener(event, listener as never),
      removeEventListener: (event, listener) => player.current?.removeEventListener(event, listener as never)
    }),
    []
  )

  return (
    <Player
      ref={player}
      // Remotion types its props as a string-keyed record; ours are the composition's own type.
      component={component as unknown as ComponentType<Record<string, unknown>>}
      inputProps={inputProps as unknown as Record<string, unknown>}
      durationInFrames={durationInFrames}
      fps={fps}
      compositionWidth={width}
      compositionHeight={height}
      controls={controls}
      loop={loop}
      autoPlay={autoPlay}
      style={style}
    />
  )
}

export const Preview = forwardRef(PreviewWith) as <P extends object>(
  props: PreviewProps<P> & { ref?: Ref<PreviewHandle> }
) => JSX.Element
