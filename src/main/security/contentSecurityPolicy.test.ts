import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from './contentSecurityPolicy'

const directives = (policy: string): Record<string, string> =>
  Object.fromEntries(
    policy.split('; ').map((part) => {
      const [name, ...values] = part.split(' ')
      return [name, values.join(' ')]
    })
  )

describe('the packaged app’s policy', () => {
  const policy = contentSecurityPolicy(false)
  const parsed = directives(policy)

  it('lets scripts come only from the app itself', () => {
    expect(parsed['script-src']).toBe("'self'")
  })

  it('allows no eval, which the built bundle does not use', () => {
    expect(policy).not.toContain('unsafe-eval')
  })

  /**
   * The point of the whole exercise: injected script that reads a key from settings still has to
   * get it off the machine, and this is what stops it.
   */
  it('permits no outbound connection beyond the local asset server', () => {
    const connect = parsed['connect-src']

    expect(connect).toContain('http://127.0.0.1:*')
    expect(connect).not.toContain('https:')
    expect(connect).not.toMatch(/\*(?!\s|$)/) // no bare wildcard host
    expect(connect).not.toContain('ws:')
  })

  it('shuts the doors this app never uses', () => {
    expect(parsed['object-src']).toBe("'none'")
    expect(parsed['base-uri']).toBe("'none'")
    expect(parsed['form-action']).toBe("'none'")
  })

  it('frames nothing but HTML scenes, served by the local asset server', () => {
    // A scene runs in a sandboxed frame; anything wider would let the editor frame the web.
    expect(parsed['frame-src']).toBe('http://127.0.0.1:*')
  })

  it('still allows what the interface genuinely needs', () => {
    // Computed style attributes on timeline and waveform elements count as inline styles.
    expect(parsed['style-src']).toContain("'unsafe-inline'")
    // Project media is served over loopback; thumbnails are drawn to blobs and data URLs.
    expect(parsed['img-src']).toContain('http://127.0.0.1:*')
    expect(parsed['media-src']).toContain('blob:')
    // elkjs and pdf.js each start a worker.
    expect(parsed['worker-src']).toContain('blob:')
  })
})

describe('the dev server’s policy', () => {
  const parsed = directives(contentSecurityPolicy(true))

  it('concedes what Vite needs to compile and hot-reload in the browser', () => {
    expect(parsed['script-src']).toContain('unsafe-eval')
    expect(parsed['connect-src']).toContain('ws:')
  })

  it('is the only policy that concedes it', () => {
    expect(contentSecurityPolicy(false)).not.toContain('unsafe-eval')
  })
})
