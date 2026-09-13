import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * A channel invoked with no handler fails only when a user reaches that button, and a handler
 * nobody invokes is dead weight that reads as working code. Neither shows up in a type check,
 * because the channel name is a string on both sides — so the two lists are compared here.
 */
const SRC = join(__dirname, '..', '..')

function sourceFiles(dir: string, extensions: string[]): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') found.push(...sourceFiles(path, extensions))
    } else if (extensions.some((extension) => entry.endsWith(extension)) && !entry.includes('.test.')) {
      found.push(path)
    }
  }
  return found
}

function channelsMatching(files: string[], pattern: RegExp): Set<string> {
  const channels = new Set<string>()
  for (const file of files) {
    const source = readFileSync(file, 'utf-8')
    for (const match of source.matchAll(pattern)) channels.add(match[1])
  }
  return channels
}

// Both calls are routinely written across several lines, so the name may not sit on the same
// line as the call itself.
const HANDLED = /ipcMain\.handle\(\s*'([^']+)'/g
const INVOKED = /ipcRenderer\.invoke\(\s*'([^']+)'/g

const handled = channelsMatching(sourceFiles(join(SRC, 'main'), ['.ts']), HANDLED)
// Every window reaches the main process through a preload bridge — the editor through one, the
// recording toolbar through a smaller one of its own. The toolbar used to invoke IPC straight
// from its HTML with node integration on, which is why that file was named here separately.
const invoked = channelsMatching(sourceFiles(join(SRC, 'preload'), ['.ts']), INVOKED)

describe('IPC channels', () => {
  it('finds channels on both sides, so a silent regex failure cannot pass this file', () => {
    expect(handled.size).toBeGreaterThan(20)
    expect(invoked.size).toBeGreaterThan(20)
  })

  it('has a handler for every channel something invokes', () => {
    const missing = [...invoked].filter((channel) => !handled.has(channel)).sort()

    expect(missing).toEqual([])
  })

  it('invokes every channel it registers a handler for', () => {
    const unused = [...handled].filter((channel) => !invoked.has(channel)).sort()

    expect(unused).toEqual([])
  })

  it('names every channel for the area it belongs to', () => {
    // Three areas: a project's own data, the app's settings, and the application menu.
    const odd = [...handled].filter((channel) => !/^(project|settings|menu):/.test(channel)).sort()

    expect(odd).toEqual([])
  })
})
