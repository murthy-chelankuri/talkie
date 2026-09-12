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
