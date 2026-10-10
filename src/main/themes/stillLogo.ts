/**
 * A logo as it looks once its animation has finished, with nothing left to move.
 *
 * Brand sites serve animated SVG logos — some draw themselves in over several seconds, with CSS
 * keyframes and SMIL together. In a video both go wrong: CSS animations run on the browser's
 * clock, and Remotion renders frames out of order across several tabs, so every frame caught the
 * logo at a different moment — half drawn, faded, gone. SMIL set to `begin="indefinite"` waits for
 * the site's own script to start it, which never comes, so it stayed at its first frame.
 *
 * So the logo is settled into its resting state, which is the one the site shows after the
 * intro: every CSS animation is jumped past its end and held there, and every SMIL animation that
 * holds its last value (`fill="freeze"`) has that value written onto its target, the rest falling
 * back to where they began. Text in, text out, so it runs wherever the theme is drawn — preview
 * and export — and fixes logos saved before this existed without touching the files.
 */
export function stillLogo(svg: string): string {
  if (!/<(animate|animateTransform|animateMotion|set)\b|@keyframes|animation\s*:/i.test(svg)) return svg

  let out = settleSmil(svg)

  // A negative delay longer than any intro starts each animation already finished; paused, it
  // stays exactly there, frame after frame. Animations that do not hold their end return to their
  // start, which is also what the site shows once they are done.
  const settle =
    '<style>*,*::before,*::after{animation-delay:-3600s!important;animation-play-state:paused!important;transition:none!important}</style>'
  out = out.replace(/(<svg\b[^>]*>)/i, `$1${settle}`)
  return out
}

/** Every SMIL animation removed, with the value it would have held written onto what it animated. */
function settleSmil(svg: string): string {
  // Self-closing or with a closing tag, and never nested — which is all SMIL ever is.
  const animation = /<(animate|animateTransform|set)\b([^>]*?)(?:\/>|>\s*<\/\1\s*>)/gi
  const held: Array<{ attribute: string; value: string; marker: string; target?: string }> = []
  let index = 0

  let out = svg.replace(animation, (_whole, kind: string, attrs: string) => {
    const read = (name: string): string | undefined =>
      new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs)?.[1]
    const isTransform = kind.toLowerCase() === 'animatetransform'
    const attribute = isTransform ? 'transform' : read('attributeName')
    const freezes = kind.toLowerCase() === 'set' || read('fill') === 'freeze'
    const last = read('to') ?? read('values')?.split(';').map((v) => v.trim()).filter(Boolean).pop()
    if (!attribute || !freezes || last === undefined) return ''

    const marker = `\u0000held${index++}\u0000`
    const target = (read('href') ?? read('xlink:href'))?.replace(/^#/, '')
    held.push({ attribute, value: isTransform ? `${read('type') ?? 'translate'}(${last})` : last, marker, target })
    return marker
  })
  out = out.replace(/<animateMotion\b[^>]*?(?:\/>|>[\s\S]*?<\/animateMotion\s*>)/gi, '')

  for (const { attribute, value, marker, target } of held) {
    const at = out.indexOf(marker)
    out = out.replace(marker, '')
    const open = target ? out.search(new RegExp(`<[\\w:-]+[^>]*\\sid="${escapeRegExp(target)}"`)) : enclosingTag(out, at)
    if (open < 0) continue
    out = withAttribute(out, open, attribute, value)
  }
  return out
}

/** Where the element containing `at` opens: back past every element that has already closed. */
function enclosingTag(text: string, at: number): number {
  let depth = 0
  let cursor = at
  while (cursor > 0) {
    const open = text.lastIndexOf('<', cursor - 1)
    if (open < 0) return -1
    const end = text.indexOf('>', open)
    const tag = text.slice(open, end + 1)
    cursor = open
    if (tag.startsWith('<!--') || tag.startsWith('<!') || tag.startsWith('<?') || tag.endsWith('/>')) continue
    if (tag.startsWith('</')) depth++
    else if (depth === 0) return open
    else depth--
  }
  return -1
}

function withAttribute(text: string, open: number, attribute: string, value: string): string {
  const end = text.indexOf('>', open)
  const selfClosing = text[end - 1] === '/'
  let tag = text.slice(open, selfClosing ? end - 1 : end)
  const escaped = value.replace(/"/g, '&quot;')
  const existing = new RegExp(`\\s${escapeRegExp(attribute)}\\s*=\\s*"[^"]*"`, 'i')
  tag = existing.test(tag) ? tag.replace(existing, ` ${attribute}="${escaped}"`) : `${tag} ${attribute}="${escaped}"`
  return text.slice(0, open) + tag + text.slice(selfClosing ? end - 1 : end)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
