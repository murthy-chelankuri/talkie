# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org).

## Unreleased

### Rendering

- Talkie now draws and exports video with its own renderer. The third-party renderer it used —
  source-available, not open source — is no longer used or installed, so building or running
  Talkie no longer needs a licence for it.
- The export draws frames in headless tabs and encodes them with Talkie's own ffmpeg, on the
  hardware encoder. It was checked against the previous renderer's export on the shipped
  examples before that renderer was removed.
- The preview plays recordings and narration as ordinary video and audio, kept within a frame of
  the clock, and loads the next clip just before a cut so it does not stall.
- The window's content security policy no longer allows inline (`data:`) media, which only the
  previous player needed.

## 1.0.0 — 2026-09-19

The first release. Talkie records a browser session silently, writes and speaks the narration,
and exports an MP4.

### Recording

- Records a browser session with Playwright, drawing what is being clicked and typed into, and
  leaning the picture towards what was clicked.
- **Show me round it** walks an app on its own, driven by the configured narration provider. It
  stops when the demo looks shown, and waits — up to five minutes, browser on screen — when the
  app wants someone to sign in, rather than recording a login screen.
- What the walk may click is an allowlist: links that stay on the origin, tabs, menu items, and
  buttons outside a form. It never types and never submits.
- Fields whose values must never be written down are the same ones only a person can fill, so
  redaction and sign-in detection ask one question from two ends.
- A session is cut into scenes, so the words have somewhere to catch up.

### Sources

- Imports slide decks and PDFs, rasterised in the window for the app and in Node for the MCP
  server, so neither pays for what it does not need.
- Renders Mermaid diagrams, drawn when they are written rather than when the app next opens, in
  the same headless Chromium that records demos.

### Narration

- Drafts the words for each clip. Providers: a built-in template that needs nothing installed,
  Claude CLI, GitHub Copilot CLI, any OpenAI-compatible local server (LM Studio, Ollama,
  llama.cpp, Jan), and the Anthropic API.
- **Script view** shows a whole project's narration top to bottom, in a column wide enough to
  read a sentence in — most of what is wrong with narration is only wrong in context. The
  timeline's box remains for a glance and a quick edit.
- Timings live in the words: a line beginning `[12.3]` is spoken at that second of its clip, and
  reads back the same way through every route that stores it.
- Narration can drive the picture, so the visuals follow the take rather than a fixed stagger.
- Rewrite a line from the right-click menu, alongside the system's own writing tools.

### Voice

- Speaks through macOS `say` or OpenAI TTS, with a pace and real pauses at full stops that keep
  it from sounding recited.
- Every project can keep a voice of its own, changeable at any time in both directions, with the
  app default as the fallback.
- The voice has a layer of its own on the timeline, showing the narration itself.
- Says why a project sounds thin, and where the better voice is.

### Asking an agent to change the project

- One instruction — "add an introduction and a closing statement" — runs against the whole
  project, as a conversation that remembers the turn before it.
- It works through Talkie's own MCP server, so the in-app agent and an outside agent are the
  same agent using the same tools. There is no second implementation.
- Agent access stays off until it is asked for, and every call checks a hashed token. A run
  cannot revoke a token an outside agent is already holding, and the whole run is one undo step.
- The tools reach reading, project context, narration, every scene kind, arranging and undo —
  not recording and not exporting, neither of which is what anyone means by "add an
  introduction".

### Export

- Exports an MP4 through a third-party renderer. The preview and the export are the same composition, so what
  is on screen is what renders.
- Captions can be burned into the picture, off by default.

### Security

- `sanitiseRichText` rebuilds markup from an allowlist rather than stripping it, because scene
  text reaches the renderer's HTML and does not only come from the user.
- The content security policy is set as a response header; the renderer has no route to the
  network, which is what keeps `settings:read` from handing API keys anywhere.
- The asset server puts a per-run secret in every URL — loopback is not a boundary, since any
  page in any browser can scan the ephemeral ports.
- No window enables `nodeIntegration`, and navigation is confined to the app's own pages.
- Settings are written `0600`.

### Fixed before release

- The chosen voice showed as something else on macOS 27, which qualifies some voice names with
  their language and lists six voices twice. Narration was unaffected; the picker was not.

### Known issue

`projectApi` mutations are read-modify-write over whole JSON files with no locking. That is safe
within the app, but the MCP server is a separate process using the same functions: if an agent
and the app touch one project at once, one side's write can overwrite the other's, and because
history is per-process, undo in one can discard the other's work. Nothing should write to a
project while an agent run is going.

### Requirements and distribution

macOS on Apple Silicon. Build from source with `npm install && npm run package`, which produces
`release/Talkie-1.0.0-arm64.dmg`. The build is ad-hoc signed, so on any machine other than the
one that built it macOS quarantines it — clear the flag once with
`xattr -dr com.apple.quarantine /Applications/Talkie.app`.

No binary is published. The renderer's compositor carries an ffmpeg built with `--enable-gpl`, x264
and x265: publishing source carries no GPL obligation, but shipping a built `.dmg` does,
including offering ffmpeg's source to every recipient.

Talkie's own code is Apache-2.0. **The renderer it uses is not open source** — free for
individuals, non-profits and companies of up to three people; larger for-profits need a paid
licence. Cloning this repository does not grant one. See `NOTICE` and Settings → Licences.
