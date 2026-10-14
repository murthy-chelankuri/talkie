import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LicencesSection } from './LicencesSection'
import notices from '../generated/notices.json'

describe('licences', () => {
  it('leads with the bundled binaries, which are the ones that constrain shipping', () => {
    render(<LicencesSection />)

    // FFmpeg decides whether this app can go in an app store at all; it should not be something
    // you reach by scrolling past two hundred MIT packages.
    expect(screen.getByText('FFmpeg')).toBeInTheDocument()
    expect(screen.getAllByText('GPL-2.0-or-later').length).toBeGreaterThan(0)
  })

  it('says what a copyleft licence actually asks for, not just its name', () => {
    render(<LicencesSection />)

    // elkjs is EPL-2.0: file-level copyleft, said plainly rather than left as an identifier.
    expect(screen.getByText(/Source for the covered module must be made available/)).toBeInTheDocument()
  })

  it('shows a package licence text only when asked for it', async () => {
    const user = userEvent.setup()
    render(<LicencesSection />)

    const clsx = screen.getByRole('button', { name: /^clsx/ })
    expect(clsx).toHaveAttribute('aria-expanded', 'false')

    await user.click(clsx)

    expect(clsx).toHaveAttribute('aria-expanded', 'true')
  })

  it('can be searched, because two hundred packages is not a list you read', async () => {
    const user = userEvent.setup()
    render(<LicencesSection />)

    await user.type(screen.getByRole('textbox', { name: 'Search packages and licences' }), 'mermaid')

    expect(screen.getByRole('button', { name: /^mermaid/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^clsx/ })).not.toBeInTheDocument()
  })

  it('says so rather than showing an empty list when nothing matches', async () => {
    const user = userEvent.setup()
    render(<LicencesSection />)

    await user.type(screen.getByRole('textbox', { name: 'Search packages and licences' }), 'zzzznope')

    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument()
  })
})

describe('the generated notices themselves', () => {
  it('carries every production package, with a licence for each', () => {
    expect(notices.packages.length).toBeGreaterThan(200)
    expect(notices.packages.every((pkg) => pkg.license && pkg.license !== 'Unstated')).toBe(true)
  })

  it('records the copyleft binaries that no package manifest mentions', () => {
    const names = notices.bundled.map((item) => item.name)

    expect(names).toContain('FFmpeg')
    // Compiled into phonemizer, whose own manifest says Apache-2.0 — see NOTICE.
    expect(names).toContain('eSpeak NG')
    // Chromium's own media library, shipped inside Electron: LGPL, with its own source duty.
    expect(names).toContain('FFmpeg (inside Electron)')
    expect(notices.bundled.every((item) => /^L?GPL-/.test(item.license))).toBe(true)
  })

  it('lists the runtime the app is, which no production dependency names', () => {
    // Electron is a dev dependency because electron-builder supplies it, yet every build is Electron.
    const chromium = notices.packages.find((pkg) => pkg.name === 'Chromium (inside Electron)')

    expect(notices.packages.find((pkg) => pkg.name === 'electron')?.text).toContain('Copyright (c) Electron contributors')
    expect(chromium?.text).toContain('The Chromium Authors')
    expect(chromium?.text).toContain('licences/electron/LICENSES.chromium.html')
  })

  it('reproduces licence text rather than only naming the licence', () => {
    const withText = notices.packages.filter((pkg) => pkg.text)

    expect(withText.length).toBeGreaterThan(notices.packages.length * 0.9)
  })

  it('carries the licence itself for every bundled copyleft component, as the GPL and LGPL ask', () => {
    for (const item of notices.bundled) {
      if (item.license.startsWith('LGPL-2.1')) {
        expect(item.text, item.name).toContain('GNU LESSER GENERAL PUBLIC LICENSE')
        expect(item.text, item.name).toContain('Version 2.1')
        continue
      }
      const version = item.license.startsWith('GPL-3') ? 'Version 3' : 'Version 2'
      expect(item.text, item.name).toContain('GNU GENERAL PUBLIC LICENSE')
      expect(item.text, item.name).toContain(version)
    }
  })

  it('says phonemizer carries GPL code, rather than repeating its Apache-only manifest', () => {
    const phonemizer = notices.packages.find((pkg) => pkg.name === 'phonemizer')

    expect(phonemizer?.license).toBe('Apache-2.0 AND GPL-3.0-or-later')
  })

  it('reproduces the ONNX Runtime notice, which its package does not carry', () => {
    const runtime = notices.packages.find((pkg) => pkg.name === 'onnxruntime-node')

    expect(runtime?.text).toContain('Copyright (c) Microsoft Corporation')
    expect(runtime?.text).toContain('ThirdPartyNotices.txt')
  })

  it('ships no libvips — sharp is Talkie’s own stand-in, not the library', () => {
    const names = notices.packages.map((pkg) => pkg.name)

    expect(names.filter((name) => name.startsWith('@img/') || name === 'sharp')).toEqual([])
  })

  it('shows the licence text of a bundled GPL component when asked for it', async () => {
    const user = userEvent.setup()
    render(<LicencesSection />)

    const [first] = screen.getAllByText('Licence text')
    await user.click(first)

    expect(screen.getAllByText(/GNU GENERAL PUBLIC LICENSE/).length).toBeGreaterThan(0)
  })
})
