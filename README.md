# Talkie

Record it silent. Give it a voice.

Talkie records a browser session or imports a slide deck, writes the narration for each clip,
speaks it, and exports an MP4.

## Running from the source

```bash
npm install
npm run dev
```

`npm test` runs the suite, `npm run typecheck` the type check. Both are expected to pass before
a build is packaged.

## Building something to hand to someone

```bash
npm run package       # a .dmg in release/
npm run package:dir   # just the .app, for testing the packaged build quickly
```

The result is `release/Talkie-<version>-arm64.dmg`, around 170MB, built for Apple Silicon.

Test the packaged app rather than only the dev build. The two differ in ways that have already
bitten: the main bundle has to be CommonJS because Electron cannot load an ES module from inside
an asar archive, `react` has to be a runtime dependency because `@remotion/renderer` requires it
in the main process, and ffmpeg has to be located explicitly because it is copied out of the
archive at build time. Each of those failed silently — the app started, reported itself ready,
and never opened a window.

### Running from source shows "Electron" in the menu bar

macOS takes the bold menu-bar title from the bundle it is running, and under `npm run dev` that
bundle is Electron's own. Nothing in the app can change it. The packaged build carries its own
bundle and reads Talkie, which is what anyone receiving it sees.

### The app is not signed

There is no Apple Developer certificate, so the build is ad-hoc signed. It runs on the machine
that built it. Anywhere else, macOS quarantines it and says the app is damaged, which is
alarming and not true. Whoever receives it has to clear the quarantine flag once:

```bash
xattr -dr com.apple.quarantine /Applications/Talkie.app
```

Signing and notarising with a Developer ID ($99/year) removes that step. The build is otherwise
ready for it: set `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
`APPLE_TEAM_ID`, remove `identity: null` from `electron-builder.yml`, and turn
`hardenedRuntime` on.

## Telling the model what the demo is about

Narration is drafted a clip at a time from an action log and a few sampled frames, which is
enough to know what moved on screen and nothing about what it was. So it writes "you click the
menu" where a presenter would say "you open the campaign builder" — not from vagueness, but
because nobody said what the product is called.

**About this demo**, in the editor panel, is where that is said once for the whole project:

| | |
| --- | --- |
| What this demo is about | the product, and the words it uses for its own parts |
| Who is watching | decides what is assumed and what is explained |
| How it should sound | a sentence is enough |
| Never say | rules, not preferences |

It reaches narration, slide writing and rewriting alike, so a slide and the words spoken over it
call the same thing by the same name.

The last one is checked rather than only asked for. A prompt is a request, and a model can be
told not to mention pricing and mention it anyway — so every draft is searched for the terms, on
word boundaries, and anything that slips through is reported instead of left for someone to find
by proofreading fifty clips.

## Rewriting narration

Select some narration, right-click, and **Rewrite** offers four things:

| | |
| --- | --- |
| Rephrase | the same thing said another way |
| Proofread | spelling, grammar and punctuation, and nothing else |
| Make concise | fewer words, every fact kept |
| Fit the clip | rewritten to the length it has to be spoken in |

The last one is why this is worth having rather than reaching for the system's own tools: Talkie
knows how long the clip runs, and speech runs at roughly 2.5 words a second, so "fit the clip"
has a real target. Going over means the voice runs past the picture.

It uses whichever provider is set in Settings → Narration, and needs one with a model behind it —
the built-in provider writes from a template and has nothing to ask. The rewrite replaces the
selection, so ⌘Z puts the original back.

Apple's Writing Tools is not available here, and cannot be: AppKit attaches it to text views it
draws itself, and this is a web view whose menu is built by the app. A newer Chromium does not
change that.

## Which voice a demo speaks in

Every demo can hold a voice of its own, chosen in the editor beside the project summary. Settings
holds the **default for new demos**; a demo that has chosen a voice keeps it, so changing the
default never turns finished work into work that looks unfinished.

The picker's first option puts a demo back to following the default, so the choice is reversible
at any point. Changing the voice never re-narrates anything by itself: existing takes stay as
they are, and the panel then offers to re-speak them in the new voice if that is what you want.

## What a recording shows

A screen recording shows the result of a click but not the click: a value changes somewhere and
the viewer has to work backwards to what was pressed. Talkie draws the control as it is used — a
ring and a ripple on a button as it is pressed, a ring held on a field for as long as it is being
typed into — so the recording can be followed without being talked through.

It is on by default and lives in Settings → Recording, along with the colour. The highlight is
drawn into the video and cannot be taken out afterwards, which is why it is a choice made before
recording rather than after.

It is drawn inside the recorded page, so it is kept out of the page's way: nothing it adds can
ever be clicked or reach the action log, and it uses no stylesheet, so a site with a strict
content policy still gets its highlights.

## Letting an AI agent make the demo

Talkie is an MCP server, so any agent that speaks MCP — Claude Code, GitHub Copilot CLI, Cursor
— can drive a real browser, record what it does, write and speak the narration, and export the
video.

It is **off until you turn it on**, and needs a token even then. In Settings → System, switch on
"Let AI agents connect" and create a token. The token is shown once — only a hash is kept — and
the screen then hands you the line to run, with the path and token already in it:

```bash
claude mcp add talkie --env TALKIE_MCP_TOKEN=<your token> -- node /path/to/out/mcp/talkie-mcp.mjs
```

Any other client takes the same thing as config:

```json
{
  "mcpServers": {
    "talkie": {
      "command": "node",
      "args": ["/path/to/out/mcp/talkie-mcp.mjs"],
      "env": { "TALKIE_MCP_TOKEN": "<your token>" }
    }
  }
}
```

Turning the switch off, or replacing the token, stops anything still holding the old one at its
next call rather than whenever it happens to restart. The server is not on a network — an agent
spawns it as a local process — so the token is not keeping anyone off a port; it is an off switch
you control and a credential you can withdraw, so that finding the server on disk is not the same
as being allowed to use it.

The server is built by `npm run build` and works whether or not the Talkie window is open —
projects are files on disk, and it reaches them through exactly the same code the app does. It
needs Node 20 or later. Set `TALKIE_HOME` to point it somewhere other than your home directory.

| Tool | What it does |
| --- | --- |
| `talkie_list_projects`, `talkie_create_project`, `talkie_timeline` | Find or start a demo, and read what is in it |
| `talkie_start_recording` | Open a real browser and start capturing it |
| `talkie_navigate`, `talkie_click`, `talkie_type`, `talkie_scroll`, `talkie_wait` | Drive that browser |
| `talkie_stop_recording`, `talkie_discard_recording` | Put the clip on the timeline, or throw it away |
| `talkie_add_scene` | Add a title slide, with a theme and accent colour |
| `talkie_set_narration`, `talkie_draft_narration`, `talkie_narrate` | Write the words, have a model write them, speak them |
| `talkie_export` | Render the MP4 |

Two things worth knowing. The agent's browser actions are paced rather than immediate, because a
recording of instant clicks is unwatchable — the page never settles and a viewer cannot see what
happened. And everything an agent does goes through the app's own undo history, so a change you
did not want can be undone in the window like any other.

If the app is open while an agent works, it will not show the new clips until the project is
reopened.

## What Talkie needs on the machine it runs on

Settings opens with what this machine can and cannot do, so a missing piece shows up before
someone presses the button that needs it rather than as an error afterwards.

| For | Needs | If it is missing |
| --- | --- | --- |
| Recording a session | Google Chrome, Edge, or Playwright's Chromium | Install Chrome, or `npx playwright install chromium` |
| Exporting video | Nothing — ffmpeg ships inside the app | — |
| Speaking narration | Nothing — macOS's own voices | — |
| Recording your own voice | Microphone permission | Talkie asks the first time; after a refusal, System Settings → Privacy & Security |
| Importing a `.pptx` | LibreOffice | `brew install --cask libreoffice`, or export the deck to PDF and import that |
| Better drafted narration | The `claude` CLI, a local model server, or an Anthropic key | The built-in drafter needs none of them |

Recording uses a browser that is already installed in preference to downloading one, since
Playwright's Chromium is a 359MB download that lives outside the app and would otherwise turn
the first recording into a failure.

Narration drafting is deliberately optional. The built-in drafter writes from the recorded
action log alone: no install, no key, no network, and nothing leaves the machine. The other
providers write better narration; two of them send screenshots off the machine, and Settings
says which.
