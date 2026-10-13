import { describe, expect, it } from 'vitest'
import { chooseRenderer } from './renderProject'

describe('choosing the exporter', () => {
  it('uses Talkie’s own when nothing says otherwise', () => {
    expect(chooseRenderer({}, {})).toBe('own')
  })

  it('uses Remotion’s when the environment asks for it', () => {
    expect(chooseRenderer({}, { TALKIE_RENDERER: 'remotion' })).toBe('remotion')
  })

  it('ignores an environment value it does not know', () => {
    expect(chooseRenderer({}, { TALKIE_RENDERER: 'other' })).toBe('own')
  })

  it('lets the option win over the environment, either way round', () => {
    expect(chooseRenderer({ renderer: 'own' }, { TALKIE_RENDERER: 'remotion' })).toBe('own')
    expect(chooseRenderer({ renderer: 'remotion' }, {})).toBe('remotion')
  })
})
