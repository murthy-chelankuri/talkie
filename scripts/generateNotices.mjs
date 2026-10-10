/**
 * Collects the licences of everything this app ships.
 *
 * Run at build time rather than read at runtime: node_modules is not inside the packaged app, so
 * a screen that walked it would be empty in the only build where it matters. The output is
 * committed, which also makes a licence change show up as a reviewable diff rather than as a
 * silent difference between two builds.
 *
 *   node scripts/generateNotices.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'src/renderer/src/generated/notices.json')

/** Files a package might keep its licence in, in the order worth trying. */
const LICENCE_FILES = [
  'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'license.txt',
  'LICENCE', 'LICENCE.md', 'LICENCE.txt', 'COPYING', 'COPYING.md', 'NOTICE'
]

/**
 * Things that ship as binaries or data rather than as npm packages with a licence field, and
 * whose terms are the ones that actually constrain how this app may be distributed. Written by
 * hand because no manifest on disk states them: the FFmpeg terms come from the binary's own
 * banner, and Remotion's from the licence text in its package.
 */
const BUNDLED = [
  {
    name: 'FFmpeg',
    version: 'n7.1',
    license: 'GPL-2.0-or-later',
    textFile: 'licences/GPL-2.0.txt',
    note:
      'Shipped inside Remotion\'s compositor and used for transcoding, frame sampling and audio ' +
      'conversion. Built with --enable-gpl, --enable-libx264 and --enable-libx265, which places ' +
      'the binary and its libav* libraries under the GPL. Source: https://ffmpeg.org/download.html',
    homepage: 'https://ffmpeg.org'
  },
  {
    name: 'x264',
    version: 'bundled with FFmpeg n7.1',
    license: 'GPL-2.0-or-later',
    textFile: 'licences/GPL-2.0.txt',
    note: 'H.264 encoder linked into the bundled FFmpeg. Source: https://www.videolan.org/developers/x264.html',
    homepage: 'https://www.videolan.org/developers/x264.html'
  },
  {
    name: 'x265',
    version: 'bundled with FFmpeg n7.1',
    license: 'GPL-2.0-or-later',
    textFile: 'licences/GPL-2.0.txt',
    note: 'HEVC encoder linked into the bundled FFmpeg. Source: https://www.videolan.org/developers/x265.html',
    homepage: 'https://www.videolan.org/developers/x265.html'
  },
  {
    name: 'eSpeak NG',
    version: 'as compiled into phonemizer 1.2.1',
    license: 'GPL-3.0-or-later',
    textFile: 'licences/GPL-3.0.txt',
    note:
      'Turns text into phonemes for the Kokoro voice. Compiled to WebAssembly inside the phonemizer ' +
      'package, whose own Apache-2.0 licence field does not cover it. Runs only in Kokoro\'s ' +
      'separate worker process, never inside Talkie itself. Source: https://github.com/espeak-ng/espeak-ng',
    homepage: 'https://github.com/espeak-ng/espeak-ng'
  }
]

/**
 * Licence texts for packages that ship none, kept in licences/ and installed beside the app.
 *
 * MIT asks for one thing — that the notice travels with every copy — and onnxruntime-node's npm
 * package carries no copy to travel. Taken from the tag matching the installed version; see
 * licences/README.md.
 */
const ONNXRUNTIME_TEXT = () =>
  `${readFileSync(join(root, 'licences/onnxruntime/LICENSE'), 'utf8').trim()}\n\n` +
  'The native library also contains third-party components, whose notices are in ' +
  'ThirdPartyNotices.txt, installed with Talkie at Talkie.app/Contents/Resources/licences/onnxruntime/.'
const VENDORED_TEXT = {
  'onnxruntime-node': ONNXRUNTIME_TEXT,
  'onnxruntime-common': ONNXRUNTIME_TEXT
}

/**
 * Packages whose manifest states less than they contain.
 *
 * phonemizer says Apache-2.0, which is true of its own JavaScript. It also carries eSpeak NG
 * compiled to WebAssembly, which is GPL-3.0-or-later — listed in BUNDLED above. Shown as its
 * manifest has it, this package would read as permissive while shipping the one GPL-3.0 component
 * in the app.
 */
const RELABELLED = {
  phonemizer: 'Apache-2.0 AND GPL-3.0-or-later'
}

function productionPackages() {
  const json = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
    // `npm ls` exits non-zero on peer-dependency complaints while still printing a usable tree.
    stdio: ['ignore', 'pipe', 'ignore']
  })
  const seen = new Set()
  const walk = (node) => {
    for (const [name, info] of Object.entries(node.dependencies ?? {})) {
      if (seen.has(name)) continue
      seen.add(name)
      walk(info)
    }
  }
  walk(JSON.parse(json.toString()))
  return [...seen].sort()
}

function licenceTextFor(dir) {
  for (const file of LICENCE_FILES) {
    const path = join(dir, file)
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8').trim()
      if (text) return text
    }
  }
  return null
}

/** The line a licence wants reproduced, when it can be found without shipping the whole text. */
function copyrightFrom(text) {
  if (!text) return null
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /copyright/i.test(l) && l.length < 200 && !/^#/.test(l))
  return line ?? null
}

/**
 * Who to credit when a package ships no licence file at all.
 *
 * MIT and the BSDs ask for the copyright notice to be reproduced, not for the licence to be
 * named — so recording only "MIT" against a package leaves the one duty it actually imposes
 * unmet. A dozen packages here state their licence in the manifest and nowhere else. The
 * manifest's author is the best available answer, and is marked as derived so nobody mistakes
 * it for a notice quoted from the package itself.
 */
function attributionFrom(pkg) {
  const from = pkg.author ?? (Array.isArray(pkg.contributors) ? pkg.contributors[0] : null)
  const name = typeof from === 'string' ? from : from?.name
  if (!name) return null
  return `Copyright (c) ${name.replace(/\s*<[^>]*>/, '').trim()} (from package.json; the package ships no licence file)`
}

function normaliseLicense(pkg) {
  const raw = pkg.license ?? pkg.licenses
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ')
  if (raw && typeof raw === 'object') return raw.type ?? null
  return null
}

/**
 * The licence a package's own text says it is, for the ones that state it nowhere machine-readable.
 * Only the unambiguous openers are matched — a guess here would be worse than saying nothing.
 */
function licenceFromText(text) {
  if (!text) return null
  const head = text.slice(0, 400)
  if (/^\s*(The )?MIT Licen[cs]e/i.test(head) || /Permission is hereby granted, free of charge/i.test(head)) return 'MIT'
  if (/Apache Licen[cs]e/i.test(head) && /Version 2\.0/i.test(head)) return 'Apache-2.0'
  if (/ISC Licen[cs]e/i.test(head)) return 'ISC'
  return null
}

/** Every Remotion package is governed by the one licence, whether or not it carries a copy. */
const REMOTION_LICENCE = licenceTextFor(join(root, 'node_modules', 'remotion'))
const isRemotion = (name) => name === 'remotion' || name.startsWith('@remotion/')

const packages = []
for (const name of productionPackages()) {
  const dir = join(root, 'node_modules', name)
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) continue

  let pkg
  try {
    pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  } catch {
    continue
  }

  // Talkie's own stand-in for sharp (stubs/sharp), not a third-party package — see its README.
  if (String(pkg.version).endsWith('-talkie-stub')) continue

  let text = licenceTextFor(dir) ?? VENDORED_TEXT[name]?.() ?? null
  let license = RELABELLED[name] ?? normaliseLicense(pkg)

  // "SEE LICENSE IN ..." names a file rather than a licence; the file is already read above.
  const namesAFile = license && /^SEE LICEN[CS]E/i.test(license)
  if (namesAFile) license = null

  // Remotion's own packages state it three different ways — a filename, the name plus a URL, or
  // nothing at all. Only the ones that state no ordinary licence are folded together: several
  // under the same scope really are MIT, and relabelling those would overstate what is
  // proprietary here.
  if (isRemotion(name) && (!license || /^Remotion Licen[cs]e/i.test(license))) {
    license = 'Remotion License'
    text ??= REMOTION_LICENCE
  } else {
    license ??= licenceFromText(text)
  }

  packages.push({
    name,
    version: pkg.version ?? '',
    license: license ?? 'Unstated',
    homepage: pkg.homepage ?? (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) ?? null,
    copyright: copyrightFrom(text) ?? attributionFrom(pkg),
    // Kept whole for the licences that require the text itself to travel with the software.
    text: text && text.length <= 24000 ? text : null
  })
}

const notices = {
  generatedAt: new Date().toISOString().slice(0, 10),
  // The GPL asks for a copy of itself with the binary, so its whole text is carried — longer than
  // the limit applied to package texts below, and not optional.
  bundled: BUNDLED.map(({ textFile, ...item }) => ({ ...item, text: readFileSync(join(root, textFile), 'utf8') })),
  packages
}

writeFileSync(OUT, `${JSON.stringify(notices, null, 2)}\n`)

const counts = packages.reduce((acc, p) => ({ ...acc, [p.license]: (acc[p.license] ?? 0) + 1 }), {})
console.log(`${packages.length} packages + ${BUNDLED.length} bundled binaries → ${OUT}`)
for (const [license, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${license}`)
}
const noText = packages.filter((p) => !p.text)
if (noText.length > 0) {
  const unattributed = noText.filter((p) => !p.copyright)
  console.log(`\n  ${noText.length} package(s) ship no licence file; their SPDX id is recorded instead.`)
  if (unattributed.length > 0) {
    // MIT and BSD want a copyright line reproduced, and for these there is nothing to reproduce
    // and nobody named to credit. Worth seeing rather than counting silently.
    console.log(`  ${unattributed.length} of those name no author either: ${unattributed.map((p) => p.name).join(', ')}`)
  }
}
