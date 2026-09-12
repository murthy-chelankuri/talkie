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
