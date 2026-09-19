import { describe, expect, it } from 'vitest'
import { buildableDiagram, revealedThrough, STEP_ATTRIBUTE } from './buildDiagram'

/** Shaped like what mermaid emits: edges first, then the nodes they join. */
const FLOWCHART = `<svg>
  <g class="edgePaths"><path class="flowchart-link" d="M0,0"/></g>
  <g class="nodes">
    <g class="node default" id="flowchart-A-0"><rect/></g>
    <g class="node default" id="flowchart-B-1"><rect/></g>
    <g class="node default" id="flowchart-C-2"><rect/></g>
  </g>
</svg>`

describe('drawing a diagram in the order it is explained', () => {
  it('gives every box a step of its own', () => {
    const built = buildableDiagram(FLOWCHART)

    expect(built.steps).toBe(3)
    expect(built.svg).toContain(`${STEP_ATTRIBUTE}="0"`)
    expect(built.svg).toContain(`${STEP_ATTRIBUTE}="2"`)
  })

  it('never lets an arrow arrive before the box it points at', () => {
    // Mermaid writes edges before the nodes they join, so taking document order at face value
    // would draw arrows into empty space.
    const built = buildableDiagram(FLOWCHART)
    const edge = /class="flowchart-link"[^>]*data-talkie-step="(\d+)"/.exec(built.svg)

    expect(edge).not.toBeNull()
    expect(Number(edge![1])).toBeGreaterThan(0)
  })

  it('leaves a picture with no boxes in it alone', () => {
    // Not every diagram mermaid draws is a flowchart, and one this cannot take apart should
    // be shown whole rather than hidden entirely.
    const plain = '<svg><circle r="4"/></svg>'

    expect(buildableDiagram(plain)).toEqual({ svg: plain, steps: 0 })
  })

  it('hides everything past the step reached', () => {
    const css = revealedThrough(1)

    expect(css).toContain(`[${STEP_ATTRIBUTE}]{opacity:0`)
    expect(css).toContain(`[${STEP_ATTRIBUTE}="0"]`)
    expect(css).toContain(`[${STEP_ATTRIBUTE}="1"]`)
    expect(css).not.toContain(`[${STEP_ATTRIBUTE}="2"]`)
  })

  it('shows nothing at all before the first step', () => {
    // -1 is where the count lands before the first thing is said, and it must not read as
    // "show step zero".
    expect(revealedThrough(-1)).not.toContain(`[${STEP_ATTRIBUTE}="0"]{`)
  })
})
