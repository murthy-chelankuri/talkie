import { useCurrentFrame } from 'remotion'
// The same shape the captions are built in; a second definition would be one to keep in step.
import type { Caption as CaptionCue } from '../main/transcript/captions'

export type { CaptionCue }

/**
 * The narration painted into the picture.
 *
 * For video that plays muted, which is most of the web. Drawn per clip rather than once over the
 * whole timeline because a cue belongs to a clip, and a clip's own Sequence already puts the
 * frame count where this needs it.
 *
 * Styled to stay readable over anything: a screen recording can be white here and black there,
 * so the words carry their own dark ground rather than relying on what is behind them.
 */
export function CaptionOverlay({ cues }: { cues: CaptionCue[] }): JSX.Element | null {
  const frame = useCurrentFrame()
  const current = cues.find((cue) => frame >= cue.startFrame && frame < cue.endFrame)
  if (!current) return null

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        // Clear of the very bottom, where a player's own controls sit.
        bottom: '7%',
        display: 'flex',
        justifyContent: 'center',
        paddingLeft: '8%',
        paddingRight: '8%',
        pointerEvents: 'none'
      }}
    >
      <span
        style={{
          maxWidth: '84%',
          background: 'rgba(10, 12, 16, 0.78)',
          color: '#ffffff',
          fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
          fontSize: 42,
          lineHeight: 1.32,
          fontWeight: 500,
          textAlign: 'center',
          padding: '14px 26px',
          borderRadius: 12,
          whiteSpace: 'pre-wrap'
        }}
      >
        {current.text}
      </span>
    </div>
  )
}
