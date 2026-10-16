/**
 * How to write an HTML scene, for whoever is writing one — an agent over MCP, or the model behind
 * "Describe it" in the app. One text, so the two are told the same rules.
 */
export const HTML_SCENE_GUIDE = `# Writing an HTML scene for Talkie

A scene is a web page drawn into a 1920×1080 video, frame by frame. It is an index.html (plus
any .css, .js, images, fonts or Lottie .json beside it), played in a sandbox: it cannot reach the
network, other windows or storage. Talkie adds its runtime to the page first, as \`window.talkie\`.

## Time is the video's, not the clock's

Talkie asks for frames in any order. Draw everything as a function of \`talkie.time\` (seconds):

    talkie.onFrame((t) => { bar.style.width = Math.min(t / 2, 1) * 1200 + 'px' })

- CSS animations, transitions and element.animate() need nothing: they are held at each frame's
  moment automatically. Make them while the page loads, or in onFrame.
- requestAnimationFrame, setTimeout, setInterval, Date and performance.now all run on video time.
- Never move something a fixed amount per tick (x += 2): frames are not drawn in order, and the
  check reports it.

## What Talkie gives the page

| | |
|---|---|
| talkie.time, talkie.frame | Where the video is |
| talkie.duration, talkie.fps | The scene's length in seconds, and frames per second (30) |
| talkie.params | Named values the person can change without code — read them, with defaults |
| talkie.theme | { background, heading, body, accent, fonts, logo } for the scene's look |
| talkie.beats | Seconds at which each line of narration starts — reveal things as they are said |
| talkie.onFrame(fn) | fn(time) for every frame; may return a promise |
| talkie.ready(promise) | Hold the first frame until it resolves |
| talkie.initialised | Resolves once params, theme and beats have arrived — they are empty before |
| talkie.anime(timeline), talkie.lottie(animation) | Hand a library animation to Talkie to drive |

Build anything that needs params or the theme like this:

    talkie.ready(talkie.initialised.then(() => { /* build from talkie.params */ }))

## Follow the theme

Use these CSS variables, never colours or fonts of your own — the check reports any other colour:

    --talkie-bg  --talkie-heading  --talkie-body  --talkie-accent
    --talkie-font-heading  --talkie-font-body  --talkie-logo (a url(), or none)

    body { background: var(--talkie-bg); color: var(--talkie-body); font-family: var(--talkie-font-body) }
    h1 { color: var(--talkie-heading); font-family: var(--talkie-font-heading) }

## Libraries

Load only these, exactly so (nothing from the internet will load):

    <script src="__TALKIE_LIB__/d3.min.js"></script>      D3 7 — charts
    <script src="__TALKIE_LIB__/anime.min.js"></script>   anime.js 3 — then talkie.anime(timeline)
    <script src="__TALKIE_LIB__/lottie.min.js"></script>  lottie-web — inline the JSON in a
                                                          <script type="application/json">

## Let the person change it

Every word and number someone might want to change — a title, points, labels, values, names —
goes in \`talkie.params\`, read with a default, and is declared with those defaults in a
\`talkie-values\` block in the head. Talkie builds its form from them, so whoever uses the
scene changes "Q3" to "Q4" without reading code; a scene with none can only be changed in its code.

    <script type="application/json" id="talkie-values">
    { "title": "Revenue by region", "points": ["North", "South"], "bars": [{ "label": "North", "value": 42 }] }
    </script>

Lists of words and lists of things (each with the same fields) both become editable rows, so
prefer them to one long string. Read each list defensively: the person may add or remove items.

## Start from a template when one fits

Talkie has ready-made scenes — a slide (title and points), steps, a timeline, a quote, a bar chart,
a counter, before-and-after, a kinetic title, a Lottie animation, a code walkthrough — each themed,
timed to the narration and already declaring its values. Starting from one and changing its
values is quicker and safer than writing a page. (Over MCP: talkie_html_templates lists them;
talkie_add_html_scene takes template.)

## Keep it readable

- Everything inside 1920×1080: text that runs out of the frame is reported.
- Large type: titles 72px or more, body 40px or more. Few words.
- A scene is on screen for a few seconds while someone talks; it shows one idea.

## Example

    <!doctype html><html><head><meta charset="utf-8">
    <script type="application/json" id="talkie-values">{ "title": "Growth" }</script>
    <style>
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: var(--talkie-bg) }
      h1 { position: absolute; left: 160px; top: 120px; margin: 0; font: 600 96px var(--talkie-font-heading); color: var(--talkie-heading) }
      .bar { position: absolute; left: 160px; top: 420px; height: 96px; background: var(--talkie-accent); border-radius: 8px }
    </style></head><body>
      <h1 id="title"></h1><div class="bar" id="bar"></div>
      <script>
        talkie.ready(talkie.initialised.then(() => {
          document.getElementById('title').textContent = talkie.params.title ?? 'Growth'
        }))
        const start = () => talkie.beats[0] ?? 0.5
        talkie.onFrame((t) => {
          const k = Math.min(Math.max((t - start()) / 1.2, 0), 1)
          document.getElementById('bar').style.width = (1 - Math.pow(1 - k, 3)) * 1600 + 'px'
        })
      </script>
    </body></html>
`
