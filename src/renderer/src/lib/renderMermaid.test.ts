import { describe, expect, it } from 'vitest'
import { normaliseSvg } from '../../../main/slides/mermaidTheme'

// What mermaid actually produces: a natural width, an inline cap, and no background.
const MERMAID_OUTPUT =
  '<svg id="d1" width="100%" xmlns="http://www.w3.org/2000/svg" class="flowchart"' +
  ' style="max-width: 552px;" viewBox="4 4 552 70">' +
  '<g class="node"><rect width="120" height="40" style="fill:#232833"/><text>Record</text></g></svg>'

describe('normaliseSvg', () => {
  it('drops the cap that keeps a wide diagram small in a large frame', () => {
    expect(normaliseSvg(MERMAID_OUTPUT)).not.toContain('max-width')
  })

  it('lets the diagram fill whatever it is given', () => {
    const svg = normaliseSvg(MERMAID_OUTPUT)

    expect(svg).toContain('width="100%"')
    expect(svg).toContain('height="100%"')
  })

  it('keeps the diagram in proportion while it scales', () => {
    expect(normaliseSvg(MERMAID_OUTPUT)).toContain('preserveAspectRatio="xMidYMid meet"')
  })

  it('keeps the viewBox, without which there is nothing to scale against', () => {
    expect(normaliseSvg(MERMAID_OUTPUT)).toContain('viewBox="4 4 552 70"')
  })

  it('paints a background, since mermaid draws on transparency', () => {
    // Saved without one, the diagram is invisible anywhere it is opened on white.
    expect(normaliseSvg(MERMAID_OUTPUT)).toContain('<rect width="100%" height="100%" fill="#171b22"/>')
  })

  it('leaves the shapes inside the diagram exactly as they were', () => {
    // Stripping width and height everywhere leaves a diagram of arrows pointing at nothing.
    const svg = normaliseSvg(MERMAID_OUTPUT)

    expect(svg).toContain('<rect width="120" height="40" style="fill:#232833"/>')
    expect(svg).toContain('<text>Record</text>')
  })

  it('only rewrites the opening tag, whatever is inside', () => {
    const svg = normaliseSvg(MERMAID_OUTPUT)

    expect(svg.match(/preserveAspectRatio/g)).toHaveLength(1)
  })
})
