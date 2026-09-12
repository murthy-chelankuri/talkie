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

    expect(screen.getByText(/Source for the covered files must be made available/)).toBeInTheDocument()
  })

  it('is honest that Remotion is not open source', () => {
    render(<LicencesSection />)

    expect(screen.getByText(/Source-available, not open source/)).toBeInTheDocument()
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

  it('records the GPL binaries that no package manifest mentions', () => {
    const names = notices.bundled.map((item) => item.name)

    expect(names).toContain('FFmpeg')
    expect(notices.bundled.every((item) => item.license.startsWith('GPL'))).toBe(true)
  })

  it('does not relabel the Remotion packages that really are MIT', () => {
    const captions = notices.packages.find((pkg) => pkg.name === '@remotion/captions')

    // Folding every @remotion/* package into the proprietary licence would overstate what is
    // actually restricted here.
    expect(captions?.license).toBe('MIT')
  })

  it('reproduces licence text rather than only naming the licence', () => {
    const withText = notices.packages.filter((pkg) => pkg.text)

    expect(withText.length).toBeGreaterThan(notices.packages.length * 0.9)
  })
})
