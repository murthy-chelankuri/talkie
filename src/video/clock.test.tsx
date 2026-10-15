import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Fill } from './clock'

// Every scene was drawn against this layer. Whatever draws it has to give the
// same layout, or slides lose their centring and media loses its size without any error.
describe('Fill', () => {
  it('covers the whole frame as a column, so a slide can centre itself', () => {
    const style = renderToStaticMarkup(<Fill style={{ background: 'red' }} />).match(/style="([^"]*)"/)?.[1] ?? ''

    for (const declaration of [
      'position:absolute',
      'top:0',
      'left:0',
      'right:0',
      'bottom:0',
      'width:100%',
      'height:100%',
      'display:flex',
      'flex-direction:column',
      'background:red'
    ]) {
      expect(style.split(';')).toContain(declaration)
    }
  })
})
