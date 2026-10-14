/**
 * Reveal a diagram a piece at a time, in step with what is being said about it.
 *
 * A diagram that arrives whole is a wall. The viewer reads all of it while the narration is
 * still on the first box, and by the time the voice reaches the last one they have stopped
 * looking. Drawn in the order it is explained, the same picture follows the sentence.
 *
 * Mermaid gives each node and each edge its own group in the SVG, so the pieces are already
 * there to be counted — nothing here parses the diagram, it only labels what mermaid marked.
 * Edges are tied to the nodes rather than given steps of their own: an arrow is not a thing
 * anyone narrates, and one appearing before the box it points at looks like a mistake.
 */

/** The attribute each piece is tagged with, read back by a stylesheet rather than per element. */
export const STEP_ATTRIBUTE = 'data-talkie-step'

export interface BuildableDiagram {
  /** The same SVG, with each node and edge tagged with the step it belongs to. */
  svg: string
  /** How many steps there are. Zero when there is nothing to build. */
  steps: number
}

/**
 * Tag every node with its step, and every edge with the step of the later box it touches.
 *
 * Document order is the order mermaid lays a graph out in, which for the diagrams anyone draws
 * to explain a product is the order they would describe it in. Edges come out of mermaid before
 * the nodes they join, so an edge is given the step after its position among the nodes — which
 * keeps an arrow from arriving ahead of what it points at.
 */
export function buildableDiagram(svg: string): BuildableDiagram {
  const nodes = [...svg.matchAll(/<g[^>]*\bclass="[^"]*\bnode\b[^"]*"[^>]*>/g)]
  if (nodes.length === 0) return { svg, steps: 0 }

  let step = 0
  let tagged = svg.replace(/<g([^>]*\bclass="[^"]*\bnode\b[^"]*")([^>]*)>/g, (_match, classes, rest) => {
    const at = step
    step += 1
    return `<g${classes}${rest} ${STEP_ATTRIBUTE}="${at}">`
  })

  // Every edge waits for the last box it could be joining, which is the safe reading without
  // taking mermaid's ids apart: an arrow late is unremarkable, an arrow early is wrong.
  let edge = 0
  tagged = tagged.replace(
    /<(g|path)([^>]*\bclass="[^"]*\b(?:edgePath|flowchart-link|edgeLabel)\b[^"]*")([^>]*)>/g,
    (_match, tag, classes, rest) => {
      edge += 1
      return `<${tag}${classes}${rest} ${STEP_ATTRIBUTE}="${Math.min(edge, step - 1)}">`
    }
  )

  return { svg: tagged, steps: step }
}

/**
 * The stylesheet that hides everything past the step reached.
 *
 * A stylesheet rather than an attribute per element per frame: the SVG is put into the document
 * as one string, and rewriting that string on every frame would be thousands of characters of
 * markup thirty times a second.
 */
export function revealedThrough(step: number): string {
  return `[${STEP_ATTRIBUTE}]{opacity:0;transition:none}${Array.from(
    { length: Math.max(0, step + 1) },
    (_, index) => `[${STEP_ATTRIBUTE}="${index}"]`
  ).join(',')}{opacity:1}`
}
