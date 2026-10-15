import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { checkoutRoot, requireCheckoutRoot } from './checkoutRoot'

const ROOT = join(__dirname, '..', '..')

describe('finding the checkout Talkie runs from', () => {
  it('finds it from the sources, where the tests run', () => {
    expect(checkoutRoot(join(ROOT, 'src', 'main', 'render', 'exporter'))).toBe(ROOT)
    expect(checkoutRoot(join(ROOT, 'src', 'main', 'htmlScene'))).toBe(ROOT)
  })

  it('finds it from the bundles, where the app and the MCP server run', () => {
    // The case that broke: `npm run dev` straight after a download runs out/main with nothing
    // else built, and a fixed count of `..` landed two folders above the repository.
    expect(checkoutRoot(join(ROOT, 'out', 'main'))).toBe(ROOT)
    expect(checkoutRoot(join(ROOT, 'out', 'mcp'))).toBe(ROOT)
  })

  it('finds nothing outside a checkout, and says what it could not build', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'talkie-not-a-checkout-'))
    try {
      expect(checkoutRoot(elsewhere)).toBeNull()
      expect(() => requireCheckoutRoot('The export page', elsewhere)).toThrow(/The export page is not built into this copy/)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})
