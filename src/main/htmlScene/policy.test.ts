import { describe, expect, it } from 'vitest'
import { injectRuntime, scenePolicy } from './policy'

describe('a scene page as served', () => {
  it('runs Talkie’s runtime before anything of its own', () => {
    const out = injectRuntime('<html><head><script>own()</script></head><body></body></html>', 'http://127.0.0.1:1/s')
    expect(out.indexOf('__talkie/runtime.js')).toBeLessThan(out.indexOf('own()'))
  })
  it('gets a head if it had none, and Talkie’s libraries where it asked for them', () => {
    const out = injectRuntime('<p>hi</p><script src="__TALKIE_LIB__/d3.min.js"></script>', 'http://127.0.0.1:1/s')
    expect(out).toMatch(/^<head><script src="http:\/\/127\.0\.0\.1:1\/s\/__talkie\/runtime\.js"><\/script><\/head>/)
    expect(out).toContain('src="http://127.0.0.1:1/s/__talkie/lib/d3.min.js"')
  })
  it('may reach nothing but its own folder and Talkie’s', () => {
    const policy = scenePolicy('http://127.0.0.1:1/s/p/sources/html/r/', 'http://127.0.0.1:1/s')
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("img-src http://127.0.0.1:1/s/p/sources/html/r/ data: blob:")
    expect(policy).toContain("script-src 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:1/s/p/sources/html/r/ http://127.0.0.1:1/s/__talkie/")
    expect(policy).toContain("form-action 'none'")
  })
})
