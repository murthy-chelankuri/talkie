import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * What the shipped licence texts promise, checked against what is installed.
 *
 * Both of these drift silently: a dependency bump changes which ONNX Runtime is shipped without
 * touching the notices copied for the old one, and a reinstall without the override would bring
 * libvips — and its eight LGPL libraries — back into the app without a single line of code
 * changing. See licences/README.md and stubs/sharp/README.md.
 */
const ROOT = join(__dirname, '..', '..', '..')

describe('licence texts shipped with the app', () => {
  it('describes the ONNX Runtime actually installed', () => {
    const installed = JSON.parse(readFileSync(join(ROOT, 'node_modules/onnxruntime-node/package.json'), 'utf-8'))
    const readme = readFileSync(join(ROOT, 'licences/README.md'), 'utf-8')

    expect(readme).toContain(`ONNX Runtime ${installed.version}`)
    expect(readme).toContain(`v${installed.version}`)
  })

  it('carries the GPL texts the bundled components are under', () => {
    expect(readFileSync(join(ROOT, 'licences/GPL-2.0.txt'), 'utf-8')).toContain('Version 2, June 1991')
    expect(readFileSync(join(ROOT, 'licences/GPL-3.0.txt'), 'utf-8')).toContain('Version 3, 29 June 2007')
  })
})

describe('sharp, left out', () => {
  it('resolves to Talkie’s stand-in, so libvips is never installed', () => {
    const sharp = JSON.parse(readFileSync(join(ROOT, 'node_modules/sharp/package.json'), 'utf-8'))

    expect(sharp.version).toMatch(/-talkie-stub$/)
    expect(existsSync(join(ROOT, 'node_modules/@img'))).toBe(false)
  })

  it('stays out of the lockfile, so a clean install does not bring it back', () => {
    const lock = readFileSync(join(ROOT, 'package-lock.json'), 'utf-8')

    expect(lock).not.toMatch(/sharp-libvips/)
  })

  it('serves HTML scenes only libraries under permissive licences, and never GSAP', () => {
    // Scenes are given these at run time, so they ship with the app. GSAP is free to use but its
    // licence forbids tools that compete with Webflow's animation builder — see the HTML scenes spec.
    const licence = (name: string): string => JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf-8')).license
    expect(licence('animejs')).toBe('MIT')
    expect(licence('d3')).toBe('ISC')
    expect(licence('lottie-web')).toBe('MIT')
    expect(licence('codemirror')).toBe('MIT')
    expect(existsSync(join(ROOT, 'node_modules/gsap'))).toBe(false)
  })
})
