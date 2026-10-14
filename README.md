# Talkie

Record it silent. Give it a voice.

Talkie records a browser session or imports a slide deck, writes the narration for each clip,
speaks it, and exports an MP4.

Talkie's own code is Apache-2.0, and it draws and exports video with its own renderer. A built
app carries GPL components — ffmpeg, and eSpeak NG inside the Kokoro voice — so read
[Licence](#licence) before you hand one to anyone.

## Running from the source

```bash
npm install
npm run dev
```

`npm test` runs the suite, `npm run typecheck` the type check. Both are expected to pass before
a build is packaged.

What has changed between versions is in [`CHANGELOG.md`](CHANGELOG.md).

## Building something to hand to someone

```bash
npm run package       # a .dmg in release/
npm run package:dir   # just the .app, for testing the packaged build quickly
```

The result is `release/Talkie-<version>-arm64.dmg`, built for Apple Silicon. It was around 170MB before Talkie carried its own ffmpeg; the pinned ffmpeg and ffprobe add about 126MB unpacked (`du -sh vendor/ffmpeg/*`), so expect the installed app to be that much larger and the disk image somewhat less, since it compresses. The figure for a current build has not been re-measured.

Test the packaged app rather than only the dev build. The two differ in ways that have already
bitten: the main bundle has to be CommonJS because Electron cannot load an ES module from inside
an asar archive, and whatever a headless browser or plain node reads — the export page, the MCP
server — has to be unpacked from the archive. Talkie's own ffmpeg is fetched on install and
packaged as extraResources, outside it. Each of those has failed silently in a packaged build and
nowhere else.

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

## Telling the model what the project is about

Narration is drafted a clip at a time from an action log and a few sampled frames, which is
enough to know what moved on screen and nothing about what it was. So it writes "you click the
menu" where a presenter would say "you open the campaign builder" — not from vagueness, but
because nobody said what the product is called.

It is asked when a project is created — the moment you are already thinking about what you are
making — and can be changed any time from **About this project** in the editor panel. Only the
name is required; everything else can stay empty.

| | |
| --- | --- |
| What this project is about | the product, and the words it uses for its own parts |
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

## Which voice a project speaks in

Every project can hold a voice of its own, chosen in the editor beside the project summary. Settings
holds the **default for new projects**; a project that has chosen a voice keeps it, so changing the
default never turns finished work into work that looks unfinished.

The picker's first option puts a project back to following the default, so the choice is reversible
at any point. Changing the voice never re-narrates anything by itself: existing takes stay as
they are, and the panel then offers to re-speak them in the new voice if that is what you want.

## What the export carries

A finished MP4 comes with a **SubRip file beside it**, built from the narration already on the
timeline — a clip knows where it starts, narration is held back a fixed beat, and each take's own
length says when its words stop. Beside rather than burned in, because captions are the first
thing anyone needs to correct.

Recorded clips **lean towards what was clicked**. The recorder writes down where every click
landed as a share of the picture, so the export can move the viewer's eye there without anyone
keyframing it — a small move, closer to leaning towards a screen than to a punch-in.

Both come out of what was already being captured. Neither asks a model or a service.

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

## Letting an AI agent make the video

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
| `talkie_list_projects`, `talkie_create_project`, `talkie_timeline` | Find or start a project, and read what is in it |
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
| Exporting video | Nothing — `npm install` fetches a pinned ffmpeg | — |
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

## Licence

Talkie's own source is [Apache-2.0](LICENSE). That covers the code in this repository and
nothing else — it cannot grant rights to the things Talkie depends on. Two of those — ffmpeg, and
eSpeak NG inside the Kokoro voice — are GPL, which matters the moment you hand someone a built
app. The full picture is in [NOTICE](NOTICE), and every dependency's
licence is listed in the app under Settings → Licences.

### No third-party renderer licence

Earlier versions rendered video with a third-party renderer that was source-available rather than
open source and needed a licence of your own. Talkie now draws and exports video with its own
renderer, so this version needs no such licence.

### ffmpeg is GPL

Talkie runs FFmpeg 9.0.2 from [Martin Riedl's build server](https://ffmpeg.martin-riedl.de),
pinned and hash-checked by `scripts/fetchFfmpeg.mjs` on `npm install` — a GPL-3.0 build
(`--enable-gpl --enable-version3`, with x264 and x265 linked in) with nothing nonfree in it. It is
**not in this repository**.

The distinction that matters:

| What you do | What it costs you |
| --- | --- |
| Clone, build and run it yourself | Nothing. No GPL code is in this repo. |
| Publish this source | Nothing. Still no GPL code in this repo. |
| **Hand someone a built app** (a `.dmg`, a release asset, a store submission) | You are distributing GPL binaries and must comply with the GPL — including offering ffmpeg's corresponding source to every recipient. |

That last row is why this repository ships no prebuilt binaries. It is also why the Mac App
Store is not a route for this app: the GPL's no-further-restrictions clause has historically
been held incompatible with app store terms, and separately, App Sandbox blocks most of what
Talkie does — spawning `say` and `afconvert`, driving a browser, and running the MCP server.
Direct distribution under a Developer ID is the workable path.

### Electron and Chromium

Talkie is an Electron app, so a build ships Electron and Chromium — some 780 components under their
own licences, installed with the app in `Resources/licences/electron/`. One of them, the FFmpeg
Chromium plays media with, is LGPL: whoever distributes a build must offer its source too. See
[NOTICE](NOTICE).

### eSpeak NG is GPL too

The Kokoro voice turns text into phonemes with `phonemizer`, whose own licence says Apache-2.0
but which carries eSpeak NG (GPL-3.0-or-later) compiled into it. It runs in a process of its own,
never inside Talkie, but a built app still ships it — with the same obligation as ffmpeg, to
offer its source to every recipient. Which eSpeak NG `phonemizer` compiled is still to be settled
before a build is published; see [NOTICE](NOTICE).
