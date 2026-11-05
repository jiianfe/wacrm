import { describe, expect, it } from 'vitest'
import { sanitizeEmailHtml } from './html'

describe('sanitizeEmailHtml', () => {
  it('removes scripts, event handlers, forms and frames', () => {
    const out = sanitizeEmailHtml(
      '<p onclick="x()">Oi</p><script>alert(1)</script><iframe src="https://evil"></iframe><form action="/x"><input></form>',
    )
    expect(out).toContain('<p>Oi</p>')
    expect(out).not.toMatch(/script|onclick|iframe|<form|<input/i)
  })

  it('keeps formatting tables and inline styles', () => {
    const out = sanitizeEmailHtml('<table width="100%"><tr><td style="color:red"><b>Total</b></td></tr></table>')
    expect(out).toContain('<table')
    expect(out).toContain('color:red')
    expect(out).toContain('<b>Total</b>')
  })

  it('opens links in a new tab without leaking the opener and drops javascript: links', () => {
    const out = sanitizeEmailHtml('<a href="https://ultratec.com.br">site</a><a href="javascript:alert(1)">x</a>')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('noopener')
    expect(out).not.toContain('javascript:')
  })

  it('drops inline CSS that can fetch or run something', () => {
    const out = sanitizeEmailHtml('<div style="background:url(https://track/x.png);color:blue">a</div>')
    expect(out).not.toContain('url(')
    expect(out).toContain('color:blue')
  })

  it('turns cid: images into embedded data URIs and drops unknown ones', () => {
    const out = sanitizeEmailHtml('<img src="cid:logo123"><img src="cid:other">', [
      { contentId: '<logo123>', contentType: 'image/png', content: Buffer.from('PNGDATA') },
    ])
    expect(out).toContain('data:image/png;base64,')
    expect(out).not.toContain('cid:')
  })
})
