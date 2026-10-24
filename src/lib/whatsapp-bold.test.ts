import { describe, expect, it } from 'vitest'
import { splitBold } from './whatsapp-bold'

describe('splitBold', () => {
  it('turns *text* into a bold part without the asterisks', () => {
    expect(splitBold('*Jean Felipe:*\nboa tarde!')).toEqual([
      { text: 'Jean Felipe:', bold: true },
      { text: '\nboa tarde!', bold: false },
    ])
  })

  it('handles bold in the middle and several pairs', () => {
    expect(splitBold('Olá *Ana*, vence *sexta*.')).toEqual([
      { text: 'Olá ', bold: false },
      { text: 'Ana', bold: true },
      { text: ', vence ', bold: false },
      { text: 'sexta', bold: true },
      { text: '.', bold: false },
    ])
  })

  it('leaves text alone when the asterisks do not hug the text', () => {
    expect(splitBold('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4', bold: false }])
    expect(splitBold('* nota *')).toEqual([{ text: '* nota *', bold: false }])
  })

  it('does not bold across lines or an unpaired asterisk', () => {
    expect(splitBold('*a\nb*')).toEqual([{ text: '*a\nb*', bold: false }])
    expect(splitBold('preço* final')).toEqual([{ text: 'preço* final', bold: false }])
  })

  it('returns a single plain part for plain text and nothing for empty text', () => {
    expect(splitBold('oi')).toEqual([{ text: 'oi', bold: false }])
    expect(splitBold('')).toEqual([])
  })
})
