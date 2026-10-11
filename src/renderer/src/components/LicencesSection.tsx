import { useMemo, useState } from 'react'
import { ChevronRight, Scale, Search, TriangleAlert } from 'lucide-react'
import notices from '../generated/notices.json'
import { Input } from './ui/Input'
import { cn } from '../lib/cn'

interface Package {
  name: string
  version: string
  license: string
  homepage: string | null
  copyright: string | null
  text: string | null
}

interface Bundled {
  name: string
  version: string
  license: string
  note: string
  homepage: string
  /** The licence itself: the GPL asks for a copy of it to travel with the binary. */
  text: string
}

/**
 * Licences that ask for more than a mention.
 *
 * Most of what this app ships is MIT or ISC, which want a copyright line reproduced and nothing
 * else. These are the ones that carry an obligation a reader might actually have to act on, so
 * they are said plainly rather than left for someone to infer from an SPDX identifier.
 */
const OBLIGATIONS: Record<string, string> = {
  'GPL-3.0-or-later':
    'Copyleft. The source must be offered to anyone who receives the binary, with no further restrictions on their rights.',
  'Apache-2.0 AND GPL-3.0-or-later':
    'The package’s own code is Apache-2.0; the eSpeak NG compiled into it is GPL-3.0-or-later. It runs only in the Kokoro voice’s own process, apart from the rest of the app.',
  'GPL-2.0-or-later':
    'Copyleft. The source must be offered to anyone who receives the binary, and no further restrictions may be placed on their rights — which is the clause that has historically conflicted with app store terms.',
  'MPL-2.0':
    'File-level copyleft. Source for the covered files must be made available; the rest of this app is unaffected.',
  '(MPL-2.0 OR Apache-2.0)':
    'File-level copyleft, or Apache-2.0 at your choice. Under MPL the covered files’ source must be available.',
  'EPL-2.0':
    'File-level copyleft with a patent grant. Source for the covered module must be made available.',
  'OFL-1.1':
    'Embedding the fonts in this app is allowed. They may not be sold on their own, and the copyright notice must travel with them.',
  'Remotion License':
    'Source-available, not open source. Free for individuals, non-profits and for-profit companies of up to three people; larger companies need a paid company licence.'
}

/** Ordered so the ones that constrain distribution are read first, not found by scrolling. */
const PROMINENCE = [
  'GPL-2.0-or-later',
  'GPL-3.0-or-later',
  'Apache-2.0 AND GPL-3.0-or-later',
  'Remotion License',
  'EPL-2.0',
  'MPL-2.0',
  '(MPL-2.0 OR Apache-2.0)',
  'OFL-1.1'
]

function rank(license: string): number {
  const at = PROMINENCE.indexOf(license)
  return at === -1 ? PROMINENCE.length : at
}

/**
 * Everything this app ships, and what its licence asks for.
 *
 * Generated at build time rather than read from node_modules, which is not inside the packaged
 * app — see scripts/generateNotices.mjs. Ordered by what constrains redistribution rather than
 * alphabetically: a list of two hundred permissive packages with the three consequential ones
 * somewhere inside it satisfies nobody, least of all a reviewer.
 */
export function LicencesSection(): JSX.Element {
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<string | null>(null)

  const packages = notices.packages as Package[]
  const bundled = notices.bundled as Bundled[]

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matching = needle
      ? packages.filter(
          (pkg) =>
            pkg.name.toLowerCase().includes(needle) || pkg.license.toLowerCase().includes(needle)
        )
      : packages

    const byLicence = new Map<string, Package[]>()
    for (const pkg of matching) {
      const existing = byLicence.get(pkg.license)
      if (existing) existing.push(pkg)
      else byLicence.set(pkg.license, [pkg])
    }

    return [...byLicence.entries()].sort(
      ([a, aPkgs], [b, bPkgs]) => rank(a) - rank(b) || bPkgs.length - aPkgs.length || a.localeCompare(b)
    )
  }, [packages, query])

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs leading-relaxed text-text-muted">
        Talkie is built on {packages.length} open-source packages and {bundled.length} bundled
        components no package manifest declares. The ones below carry obligations that apply when
        the app is distributed. Their licence texts are also installed with the app, in
        Talkie.app/Contents/Resources/licences.
      </p>

      {/* First, because these are the ones that decide how this app may be shipped at all. */}
      <div className="flex flex-col gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
          Bundled GPL components
        </h3>
        {bundled.map((item) => (
          <div key={item.name} className="rounded-lg border border-danger/35 bg-danger/[0.06] p-3.5">
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[13px] font-medium text-text">{item.name}</span>
              <span className="text-[11px] tabular-nums text-text-muted">{item.version}</span>
              <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger">
                {item.license}
              </span>
            </span>
            <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">{item.note}</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-accent">Licence text</summary>
              <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-raised p-2.5 font-mono text-[10px] leading-relaxed text-text-muted">
                {item.text}
              </pre>
            </details>
          </div>
        ))}
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-text-muted">
          <TriangleAlert size={13} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          These are GPL. Distributing this app means offering their source to whoever receives it,
          and the GPL&rsquo;s no-further-restrictions clause is what has historically kept GPL
          software out of app stores.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
            Packages
          </h3>
          <span className="relative">
            <Search
              size={12}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted"
              aria-hidden="true"
            />
            <Input
              aria-label="Search packages and licences"
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-7 w-40 pl-7 text-[11px]"
            />
          </span>
        </div>

        {groups.length === 0 && (
          <p className="rounded-xl bg-raised p-3 text-[11px] text-text-muted">
            Nothing matches &ldquo;{query}&rdquo;.
          </p>
        )}

        {groups.map(([license, items]) => (
          <div key={license} className="rounded-xl bg-raised">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border px-3.5 py-2.5">
              <span className="text-[12px] font-medium text-text">{license}</span>
              <span className="text-[11px] tabular-nums text-text-muted">
                {items.length} package{items.length === 1 ? '' : 's'}
              </span>
            </div>

            {OBLIGATIONS[license] && (
              <p className="border-b border-border px-3.5 py-2 text-[11px] leading-relaxed text-text-muted">
                {OBLIGATIONS[license]}
              </p>
            )}

            <ul className="divide-y divide-border">
              {items.map((pkg) => {
                const key = `${pkg.name}@${pkg.version}`
                const open = opened === key
                return (
                  <li key={key}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpened(open ? null : key)}
                      className="flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors hover:bg-surface-hover"
                    >
                      <ChevronRight
                        size={12}
                        aria-hidden="true"
                        className={cn('shrink-0 text-text-muted transition-transform', open && 'rotate-90')}
                      />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-text">{pkg.name}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-text-muted">
                        {pkg.version}
                      </span>
                    </button>

                    {open && (
                      <div className="px-3.5 pb-3 pl-[1.9rem]">
                        {pkg.homepage && (
                          <p className="mb-1.5 truncate text-[10px] text-text-muted">{pkg.homepage}</p>
                        )}
                        {/* The licence text itself, because reproducing it is the obligation —
                            a summary of it would not be the notice these licences ask for. */}
                        {pkg.text ? (
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-raised p-2.5 font-mono text-[10px] leading-relaxed text-text-muted">
                            {pkg.text}
                          </pre>
                        ) : (
                          <p className="text-[11px] leading-relaxed text-text-muted">
                            {pkg.copyright ?? `Licensed under ${pkg.license}.`} This package ships no
                            licence file of its own.
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <p className="flex items-start gap-2 border-t border-border pt-4 text-[11px] leading-relaxed text-text-muted">
        <Scale size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        Generated from the dependency tree on {notices.generatedAt}. Talkie&rsquo;s own source is
        Apache-2.0.
      </p>
    </div>
  )
}
