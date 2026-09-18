/**
 * What the recorder can see of a page, as text.
 *
 * The narration providers take a prompt and give back a string — there is no picture in that
 * interface — so exploring has to be done by reading the page rather than looking at it. This
 * gathers the two things a decision needs: where it is, and what there is to click.
 *
 * Candidates are marked with an attribute as they are found, and that attribute is the selector
 * handed back. Building CSS selectors out of class names is the usual approach and it breaks on
 * exactly the apps worth demoing — generated class names, duplicate ids, text that repeats in a
 * header and a footer.
 */
export const CANDIDATE_ATTRIBUTE = 'data-talkie-candidate'

/** How many controls to offer. Past this a page is a menu of everything and a choice of nothing. */
export const MAX_CANDIDATES = 40

/** Enough of the page's own words to tell one screen from another. */
export const MAX_TEXT_CHARS = 1200

export const READ_PAGE_SCRIPT = `
(() => {
  const MAX = ${MAX_CANDIDATES}
  const ATTR = '${CANDIDATE_ATTRIBUTE}'

  for (const marked of document.querySelectorAll('[' + ATTR + ']')) marked.removeAttribute(ATTR)

  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label')
    if (aria && aria.trim()) return aria.trim()
    const title = el.getAttribute('title')
    const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()
    return (text || (title || '').trim()).slice(0, 80)
  }

  // Off-screen, zero-sized and hidden things are not choices a person would have.
  const onScreen = (el) => {
    const box = el.getBoundingClientRect()
    if (box.width < 4 || box.height < 4) return false
    const style = window.getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
  }

  const candidates = []
  const selector = 'a, button, [role=tab], [role=menuitem], [role=menuitemradio], [role=treeitem], [role=button], [role=link], input, textarea, select'

  let index = 0
  for (const el of document.querySelectorAll(selector)) {
    if (candidates.length >= MAX) break
    if (!onScreen(el)) continue

    const label = labelOf(el)
    if (!label) continue

    const mark = 'c' + index++
    el.setAttribute(ATTR, mark)
    candidates.push({
      selector: '[' + ATTR + '="' + mark + '"]',
      label,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      href: el.getAttribute('href') || undefined,
      inForm: Boolean(el.closest('form')),
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'
    })
  }

  // The fields on the page, separately from what can be clicked. Nothing is ever typed into
  // them; they are how a sign-in wall is recognised — see authWall.ts.
  const fields = []
  for (const el of document.querySelectorAll('input')) {
    if (!onScreen(el)) continue
    fields.push({
      type: el.getAttribute('type') || 'text',
      autocomplete: el.getAttribute('autocomplete') || undefined,
      name: el.getAttribute('name') || undefined,
      id: el.id || undefined
    })
  }

  const heading = document.querySelector('h1, h2')
  return {
    url: location.href,
    origin: location.origin,
    title: document.title,
    heading: heading ? (heading.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : '',
    text: (document.body ? document.body.innerText || '' : '').replace(/\\s+/g, ' ').trim().slice(0, ${MAX_TEXT_CHARS}),
    fields,
    candidates
  }
})()
`
