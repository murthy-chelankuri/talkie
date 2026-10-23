import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemesSection } from './ThemesSection'
import { ThemeEditor } from './ThemeEditor'
import { CreateThemeDialog } from './CreateThemeDialog'
import { ThemePicker } from './ThemePicker'
import { defaultThemeDraft } from '../../../../main/themes/schema'
import { themeClient } from '../../api/projectClient'
import { BUILTIN_THEMES } from '../../../../main/themes/builtinThemes'

vi.mock('./ThemePreview', () => ({ ThemePreview: () => <div data-testid="preview" /> }))
vi.mock('../../api/projectClient', () => ({
  themeClient: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    duplicate: vi.fn(),
    usage: vi.fn(),
    generate: vi.fn(),
    generateStatus: vi.fn(),
    compliance: vi.fn(),
    addAsset: vi.fn(),
    addFont: vi.fn(),
    fontFiles: vi.fn(),
    render: vi.fn()
  }
}))

const midnight = BUILTIN_THEMES.find((theme) => theme.id === 'builtin-midnight')!
const acme = { ...defaultThemeDraft('Acme'), id: 't1', createdAt: '2026-10-09', schemaVersion: 1, company: 'Acme' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(themeClient.list).mockResolvedValue([acme] as never)
  vi.mocked(themeClient.usage).mockResolvedValue([] as never)
  vi.mocked(themeClient.generateStatus).mockResolvedValue({ running: true, step: 'Reading acme.com…' } as never)
  vi.mocked(themeClient.fontFiles).mockResolvedValue([] as never)
  vi.mocked(themeClient.compliance).mockResolvedValue([] as never)
})

describe('the theme library', () => {
  it('lists the themes there are, with both ways to make another', async () => {
    render(<ThemesSection />)

    expect(await screen.findByText('Acme')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create with AI/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New theme/ })).toBeInTheDocument()
  })

  it('says how to start when the person has none of their own', async () => {
    vi.mocked(themeClient.list).mockResolvedValue([midnight] as never)
    render(<ThemesSection />)

    expect(await screen.findByText('No themes yet')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Built into Talkie' })).getByText('Midnight')).toBeInTheDocument()
  })

  it('keeps the built-in themes apart from the person’s own', async () => {
    vi.mocked(themeClient.list).mockResolvedValue([acme, midnight] as never)
    render(<ThemesSection />)

    expect(within(await screen.findByRole('region', { name: 'Your themes' })).getByText('Acme')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Built into Talkie' })).getByText('Midnight')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Built into Talkie' })).queryByText('Acme')).toBeNull()
  })

  it('opens a built-in theme to look at, and duplicating it opens the copy to change', async () => {
    vi.mocked(themeClient.list).mockResolvedValue([midnight] as never)
    vi.mocked(themeClient.duplicate).mockResolvedValue({ ...midnight, id: 't9', name: 'Midnight copy' } as never)
    render(<ThemesSection />)

    await userEvent.click(await screen.findByText('Midnight'))

    expect(screen.getByRole('textbox', { name: 'Theme name' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Delete theme/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Save theme/ })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /Duplicate/ }))

    expect(themeClient.duplicate).toHaveBeenCalledWith('builtin-midnight')
    expect(screen.getByRole('textbox', { name: 'Theme name' })).toHaveValue('Midnight copy')
    expect(screen.getByRole('textbox', { name: 'Theme name' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Delete theme/ })).toBeInTheDocument()
  })

  it('opens a theme to edit it', async () => {
    render(<ThemesSection />)

    await userEvent.click(await screen.findByText('Acme'))

    expect(screen.getByRole('textbox', { name: 'Theme name' })).toHaveValue('Acme')
  })
})

describe('editing a theme', () => {
  it('says when a colour cannot be read on its background', () => {
    const draft = defaultThemeDraft('Acme')
    draft.variants.light.body = '#f0f0f0'
    render(<ThemeEditor initial={draft} themeId="t1" onDone={() => {}} />)

    expect(screen.getAllByText('Hard to read').length).toBeGreaterThan(0)
  })

  it('saves the changes made', async () => {
    const onDone = vi.fn()
    render(<ThemeEditor initial={defaultThemeDraft('Acme')} themeId="t1" onDone={onDone} />)

    await userEvent.type(screen.getByRole('textbox', { name: 'Tagline' }), 'Payments, simply')
    await userEvent.click(screen.getByRole('button', { name: /Save theme/ }))

    expect(themeClient.update).toHaveBeenCalledWith('t1', expect.objectContaining({ tagline: 'Payments, simply' }))
    expect(onDone).toHaveBeenCalled()
  })

  it('saves a made theme as new, with the folder its files wait in', async () => {
    render(<ThemeEditor initial={defaultThemeDraft('Acme')} stagingDir="/drafts/x" onDone={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /Save theme/ }))

    expect(themeClient.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme' }), '/drafts/x')
  })

  it('offers a light-background and a dark-background logo', () => {
    render(<ThemeEditor initial={defaultThemeDraft('Acme')} stagingDir="/drafts/x" onDone={() => {}} />)

    expect(screen.getByLabelText(/Logo for light backgrounds/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Logo for dark backgrounds/)).toBeInTheDocument()
  })

  it('lists the brand-check warnings it is told about', async () => {
    vi.mocked(themeClient.compliance).mockResolvedValue([
      { severity: 'warn', group: 'variants.light', message: 'light body (#f0f0f0) is hard to read on #ffffff.' }
    ] as never)
    render(<ThemeEditor initial={defaultThemeDraft('Acme')} themeId="t1" onDone={() => {}} />)

    expect(await screen.findByText(/hard to read on #ffffff/)).toBeInTheDocument()
  })

  it('freezes the colours when they are locked', async () => {
    render(<ThemeEditor initial={defaultThemeDraft('Acme')} themeId="t1" onDone={() => {}} />)

    const coloursHeading = screen.getByRole('heading', { name: 'Colours' })
    const section = coloursHeading.closest('section')!
    await userEvent.click(within(section).getByRole('button', { name: /Lock/ }))

    expect(within(section).getByLabelText('Brand background colour')).toBeDisabled()
  })

  describe('the company’s own fonts', () => {
    const faces = {
      'AcmeSans-Regular.otf': { file: 'fonts/AcmeSans-Regular.otf', family: 'Acme Sans', face: 'Regular', weight: 400, italic: false, variable: false },
      'AcmeSans-Bold.otf': { file: 'fonts/AcmeSans-Bold.otf', family: 'Acme Sans', face: 'Bold', weight: 700, italic: false, variable: false }
    } as const
    const font = (name: keyof typeof faces): File => new File(['x'], name, { type: 'font/otf' })

    beforeEach(() => {
      // jsdom's File has no arrayBuffer(); the browser's does.
      File.prototype.arrayBuffer ??= function (this: File): Promise<ArrayBuffer> {
        return new Promise((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.readAsArrayBuffer(this)
        })
      }
      vi.mocked(themeClient.addFont).mockImplementation((async (_target: unknown, name: keyof typeof faces) => faces[name]) as never)
      vi.mocked(themeClient.fontFiles).mockImplementation((async (_target: unknown, files: string[]) =>
        Object.values(faces).filter((face) => files.includes(face.file))) as never)
    })

    it('takes several files at once, names the family from them, and lists each as the face it is', async () => {
      render(<ThemeEditor initial={defaultThemeDraft('Acme')} themeId="t1" onDone={() => {}} />)

      await userEvent.upload(screen.getAllByLabelText('Upload your font files')[0], [font('AcmeSans-Regular.otf'), font('AcmeSans-Bold.otf')])

      // The files are read one after another; under load that takes more than a tick.
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'heading font' })).toHaveValue('Acme Sans'))
      const listed = await screen.findByRole('list', { name: 'heading font files' })
      expect(listed).toHaveTextContent('Regular')
      expect(listed).toHaveTextContent('Bold')
      await userEvent.click(screen.getByRole('button', { name: /Save theme/ }))
      expect(themeClient.update).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({
          fonts: expect.objectContaining({
            heading: { family: 'Acme Sans', source: 'user', files: ['fonts/AcmeSans-Regular.otf', 'fonts/AcmeSans-Bold.otf'] }
          })
        })
      )
    })

    it('uses the same font for the body in one press, and falls back to Talkie’s own when the last file goes', async () => {
      render(<ThemeEditor initial={defaultThemeDraft('Acme')} themeId="t1" onDone={() => {}} />)
      await userEvent.upload(screen.getAllByLabelText('Upload your font files')[0], [font('AcmeSans-Regular.otf')])

      await userEvent.click(await screen.findByRole('button', { name: 'Use for body too' }))
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'body font' })).toHaveValue('Acme Sans'))

      await userEvent.click(await screen.findAllByRole('button', { name: 'Remove AcmeSans-Regular.otf' }).then((all) => all[0]))
      expect(screen.getByRole('textbox', { name: 'heading font' })).not.toHaveValue('Acme Sans')
    })

    it('says why a file that is not a font was turned away', async () => {
      vi.mocked(themeClient.addFont).mockRejectedValue(new Error('notes.pdf is not a font Talkie can read.') as never)
      render(<ThemeEditor initial={defaultThemeDraft('Acme')} themeId="t1" onDone={() => {}} />)

      await userEvent.upload(screen.getAllByLabelText('Upload your font files')[0], [new File(['x'], 'notes.otf')], { applyAccept: false })

      expect(await screen.findByText(/not a font Talkie can read/)).toBeInTheDocument()
    })
  })

  it('names the projects that use a theme before deleting it', async () => {
    vi.mocked(themeClient.usage).mockResolvedValue([{ id: 'p1', name: 'Launch video' }] as never)
    render(<ThemeEditor initial={defaultThemeDraft('Acme')} themeId="t1" onDone={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /Delete theme/ }))

    expect(await screen.findByText(/Launch video uses this theme/)).toBeInTheDocument()
    expect(themeClient.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /Yes, delete it/ }))
    expect(themeClient.remove).toHaveBeenCalledWith('t1')
  })

  it('shows what an AI-made theme was made from, and what it changed', () => {
    const draft = { ...defaultThemeDraft('Acme'), provenance: { from: ['website'], notes: ['Graphik is not an open font, so Inter stands in for it.'] } }
    render(<ThemeEditor initial={draft} stagingDir="/drafts/x" onDone={() => {}} />)

    expect(screen.getByText(/Inter stands in/)).toBeInTheDocument()
  })
})

describe('making a theme with AI', () => {
  it('waits for something to work from', () => {
    render(<CreateThemeDialog onCreated={() => {}} onCancel={() => {}} />)

    expect(screen.getByRole('button', { name: /Create theme/ })).toBeDisabled()
  })

  it('shows what it is doing, then hands the draft on', async () => {
    let finish: (value: unknown) => void = () => {}
    vi.mocked(themeClient.generate).mockReturnValue(new Promise((resolve) => (finish = resolve)) as never)
    const onCreated = vi.fn()
    render(<CreateThemeDialog onCreated={onCreated} onCancel={() => {}} />)

    await userEvent.type(screen.getByRole('textbox', { name: 'Website' }), 'acme.com')
    await userEvent.click(screen.getByRole('button', { name: /Create theme/ }))

    expect(await screen.findByText('Reading acme.com…', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(themeClient.generate).toHaveBeenCalledWith(expect.objectContaining({ name: 'acme.com', url: 'acme.com' }))
    finish({ draft: defaultThemeDraft('Acme'), stagingDir: '/drafts/x' })
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ draft: expect.anything(), stagingDir: '/drafts/x' }))
  })

  it('says why it could not, in words rather than as an IPC error', async () => {
    vi.mocked(themeClient.generate).mockRejectedValue(
      new Error("Error invoking remote method 'settings:themes:generate': Error: acme.com asked for a sign-in. Try a description or a logo instead.")
    )
    render(<CreateThemeDialog onCreated={() => {}} onCancel={() => {}} />)

    await userEvent.type(screen.getByRole('textbox', { name: 'Website' }), 'acme.com')
    await userEvent.click(screen.getByRole('button', { name: /Create theme/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/^acme.com asked for a sign-in/)
  })
})

describe('choosing a project’s theme', () => {
  it('applies the theme chosen, and can go back to Talkie’s own look', async () => {
    const onChange = vi.fn()
    render(<ThemePicker onChange={onChange} />)
    await screen.findByRole('option', { name: 'Acme' })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 't1')
    expect(onChange).toHaveBeenLastCalledWith('t1')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), '')
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
