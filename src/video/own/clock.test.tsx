// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { useEffect } from 'react'
import { render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OwnFill, OwnSequence, VideoRoot, useOwnFrame, useOwnVideoConfig } from './clock'

/**
 * Talkie's own clock, held to the rules every scene was first drawn against
 * (see the docblocks in ../clock.tsx). These run without a browser: the frame is a prop.
 */
function Show(): JSX.Element {
  const frame = useOwnFrame()
  const { durationInFrames } = useOwnVideoConfig()
  return <i>{`${frame}/${durationInFrames}`}</i>
}

const at = (frame: number, children: JSX.Element): string =>
  renderToStaticMarkup(
    <VideoRoot frame={frame} fps={30} width={1920} height={1080} durationInFrames={300} mode="export">
      {children}
    </VideoRoot>
  )

describe('Talkie’s own clock', () => {
  it('counts frames from the start of the enclosing Sequence, and reports its length', () => {
    expect(at(40, <OwnSequence from={30} durationInFrames={60}><Show /></OwnSequence>)).toContain('<i>10/60</i>')
  })

  it('keeps a clip the preview mounted early mounted through the cut, so what it loaded is what plays', () => {
    let mounts = 0
    function Clip(): JSX.Element {
      useEffect(() => void mounts++, [])
      return <Show />
    }
    const preview = (frame: number): JSX.Element => (
      <VideoRoot frame={frame} fps={30} width={1920} height={1080} durationInFrames={300} mode="preview">
        <OwnSequence from={30} durationInFrames={60}><Clip /></OwnSequence>
      </VideoRoot>
    )
    const view = render(preview(25))
    expect(view.container.innerHTML).toContain('<i>0/60</i>')
    view.rerender(preview(31))
    view.rerender(preview(32))
    expect(view.container.innerHTML).toContain('<i>2/60</i>')
    expect(mounts).toBe(1)
  })

  it('mounts a Sequence only while the frame is inside it', () => {
    expect(at(29, <OwnSequence from={30} durationInFrames={60}><Show /></OwnSequence>)).not.toContain('<i>')
    expect(at(90, <OwnSequence from={30} durationInFrames={60}><Show /></OwnSequence>)).not.toContain('<i>')
  })

  it('ends a nested Sequence with its parent, so a long take is cut at its clip’s end', () => {
    const nested = (
      <OwnSequence from={30} durationInFrames={60}>
        <OwnSequence from={18}><Show /></OwnSequence>
      </OwnSequence>
    )
    expect(at(50, nested)).toContain('<i>2/42</i>')
    expect(at(90, nested)).not.toContain('<i>')
  })

  it('reports the whole video’s length outside any Sequence', () => {
    expect(at(5, <Show />)).toContain('<i>5/300</i>')
  })

  it('lays a Sequence’s children out in one full-frame column, as a Fill', () => {
    const markup = at(40, <OwnSequence from={30}><b /></OwnSequence>)
    for (const rule of ['position:absolute', 'top:0', 'left:0', 'right:0', 'bottom:0', 'width:100%', 'height:100%', 'display:flex', 'flex-direction:column']) {
      expect(markup).toContain(rule)
    }
  })

  it('applies a Fill’s own style over its layout', () => {
    expect(at(0, <OwnFill style={{ background: 'red', justifyContent: 'center' }} />)).toMatch(/display:flex;flex-direction:column;background:red;justify-content:center/)
  })
})
