# phonemizer, with eSpeak NG built from known source

Kokoro reads text as phonemes, and gets them from `phonemizer` — a small wrapper by Xenova around
eSpeak NG compiled to JavaScript. The npm package (1.2.1) ships that compiled eSpeak NG with no
record of what it was built from, and labels the whole package Apache-2.0. eSpeak NG is
GPL-3.0-or-later, so shipping it means offering its *corresponding* source, and a build nobody
can trace has none to offer. This package is the same wrapper around an eSpeak NG Talkie built
itself, from the source pinned below, so the source of what ships is known exactly.

The root `package.json` depends on it as `file:packages/phonemizer` and overrides `phonemizer`
with it, so `kokoro-js` loads this one unchanged — the same arrangement as `stubs/sharp`.

## What is here

| File | What it is | Licence |
|---|---|---|
| `src/phonemizer.js` | Xenova's wrapper, unchanged from [phonemizer.js](https://github.com/xenova/phonemizer.js) commit `6835144b7ee9043129222549c1ed2f6a27216278` (v1.2.1) | Apache-2.0, `LICENSE` |
| `types/` | Its type declarations, from the 1.2.1 npm package | Apache-2.0, `LICENSE` |
| `src/espeakng.worker.js` | eSpeak NG, built as below | GPL-3.0-or-later, `COPYING` |
| `dist/phonemizer.cjs` | The two above bundled for `require()`, which is how the Kokoro worker loads it | GPL-3.0-or-later |
| `build/` | The build script, the step that embeds the data, and two patches | GPL-3.0-or-later, like what they patch |
| `test/expected.json` | What npm's phonemizer 1.2.1 made of a corpus, which this build must match | — |

## The source

eSpeak NG at commit [`b774a8fd712e2b43510c1cb6c2b8cd3f22fe0a86`](https://github.com/espeak-ng/espeak-ng/tree/b774a8fd712e2b43510c1cb6c2b8cd3f22fe0a86),
fetched as `https://github.com/espeak-ng/espeak-ng/archive/b774a8fd712e2b43510c1cb6c2b8cd3f22fe0a86.tar.gz`,
SHA-256 `e080573e4e0f60c52b7ca9963a8ea52560500e47190bccf795f23986c299bdfd`, plus the two patches in
`build/patches/`.

Why that commit rather than a release: it is the one npm's phonemizer was built from. Its compiled
English data — `en_dict`, `intonations`, `phondata`, `phonindex`, `phontab`, packed into a
890,802-byte data package — is byte for byte the data inside phonemizer 1.2.1, which no release
reproduces. (It is the head of eSpeak NG pull request #1883, merged on 25 March 2024 as
`890071ff`.) Release 1.52.0 would have changed how about one English word in twenty-six is
pronounced (`oːɹ` becomes `ɔːɹ`, for one), and so changed every voice Kokoro reads in.

The patches:

- `0001-compat-wctype-include-wchar-before-renaming.patch` — a compile fix. Emscripten's C
  library declares `iswalnum()` and the rest in `<wchar.h>` with its own `wint_t`; eSpeak NG's
  compatibility header renames them to ucd's functions first, and the two declarations then
  conflict. Including `<wchar.h>` before the renaming lets each keep its own name.
- `0002-glue-ipa-without-phoneme-separator.patch` — eSpeak NG's JavaScript glue asks for a space
  between phonemes (`h ə l ˈoʊ`); phonemizer has always returned them run together within a
  word (`həlˈoʊ`), and Kokoro was trained on that. The npm build must have carried the same
  change. Without it every word comes out wrong.

## Building it

macOS, Apple Silicon, one-time:

```sh
brew install autoconf automake libtool pkg-config
git clone https://github.com/emscripten-core/emsdk ~/.cache/talkie-emsdk
~/.cache/talkie-emsdk/emsdk install 3.1.74
~/.cache/talkie-emsdk/emsdk activate 3.1.74
```

Then, from the repository, with `npm install` already run (for esbuild):

```sh
source ~/.cache/talkie-emsdk/emsdk_env.sh
packages/phonemizer/build/build.sh
```

It downloads and checks the source, builds eSpeak NG natively once to compile the English data,
applies the patches, builds the library again with Emscripten, links it with eSpeak NG's own
`emscripten/Makefile`, and writes `src/espeakng.worker.js` and `dist/phonemizer.cjs`. About a
minute. It works in `~/.cache/te-build` (`ESPEAK_WORK` to change it), which must be a short path:
eSpeak NG keeps its data directory in a 160-byte buffer and silently truncates a longer one, and
the compiled data is then missing files. One line of its output reads `error: cannot parse the
debug map for 'src/.libs/libespeak-ng.1.dylib'` — the shared library libtool also tries to make,
which nothing uses; the build carries on and succeeds.

Three things differ from eSpeak NG's own instructions, all in `build.sh` with the reason beside
each: Xcode's linker needs `-Wl,-not_for_dyld_shared_cache` for the native build; the Makefile's
`--memory-init-file 0` no longer exists in Emscripten and is dropped; and `-s ENVIRONMENT=web,worker`
leaves out the Node branch, whose `require()` calls an ES module does not have. The worker runs in
Node regardless — it needs only what Node has as a browser has it (`fetch`'s `Response`, `Blob`,
`DecompressionStream`, `atob`).

`build/embed.py` then puts the data package inside the worker (gzip, then base64, inflated with
`DecompressionStream` when the module loads), the shape npm's worker had, because a module loaded
from inside an Electron archive has nowhere reliable to fetch a second file from. It replaces the
one function that would have fetched it and adds `export default Module`; the rest is Emscripten's
output untouched.

## What it produces

Run twice from clean, the build gives the same bytes:

| File | SHA-256 |
|---|---|
| `espeakng.worker.data` (intermediate) | `6262621f3f8267fb61ef41fe7af75b8fe7e2315d6c9092afd29d7629bb21a60b` — identical to the data inside npm's phonemizer 1.2.1 |
| `src/espeakng.worker.js` | `4cc061cc78714c94acae5346597205afd56138a5cdc30608ca561311e4c90e84` |
| `dist/phonemizer.cjs` | `1decff5219cf5628cf6fbd85ccb3ff01e0be908088c5c672478c208971f7cb69` |

Built with Emscripten 3.1.74, Python 3.12, autoconf 2.73, automake 1.19, GNU libtool 2.6.2, esbuild
0.21.5. Another version of any of them may give different bytes for the same program; the
phonemes are what has to stay the same.

## Checking it

`src/main/tts/kokoro/phonemizer.test.ts` holds both entry points to `test/expected.json`, which
covers the narration of every shipped example, the end-to-end run's lines, and numbers, money,
dates, abbreviations, accents and punctuation, in both US and British English. When it was built,
the whole of a 237,727-word English word list was also phonemized by this build and by npm's, in
both voices, and every word came out the same.

## Changing it

Rebuild only to move to another eSpeak NG. Then: change `COMMIT` and `ARCHIVE_SHA256` in
`build.sh`, rebuild, expect `test/expected.json` to disagree, listen to the difference in Kokoro,
and if it is wanted, write the new build's phonemes into it and update this page — the hashes, the commit, and the
version in `package.json`.
