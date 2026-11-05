import sanitizeHtml from 'sanitize-html'

/** The sanitized HTML kept per message is cut here (the original is cut by the mailbox sync anyway). */
export const MAX_HTML_CHARS = 400_000
/** One inline (cid:) image may be at most this big once embedded. */
const MAX_INLINE_IMAGE_BYTES = 600_000
/** All inline images of one e-mail together. */
const MAX_INLINE_TOTAL_BYTES = 2_000_000

export interface InlineImage {
  contentId: string
  contentType: string
  content: Buffer
}

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp)$/i

/**
 * Replace `cid:` references with data: URIs built from the message's own
 * inline parts, so the image shows without any network request. Images that
 * are too big, or not a plain raster type, are dropped.
 */
function inlineCidImages(html: string, images: InlineImage[]): string {
  let total = 0
  const byCid = new Map<string, string>()
  for (const img of images) {
    const cid = img.contentId.replace(/^<|>$/g, '')
    if (!cid || !IMAGE_TYPES.test(img.contentType)) continue
    if (img.content.length > MAX_INLINE_IMAGE_BYTES) continue
    if (total + img.content.length > MAX_INLINE_TOTAL_BYTES) continue
    total += img.content.length
    byCid.set(cid, `data:${img.contentType.toLowerCase()};base64,${img.content.toString('base64')}`)
  }
  return html.replace(/cid:([^"'\s)>]+)/gi, (_m, cid: string) => byCid.get(decodeURIComponent(cid)) ?? '')
}

/**
 * Make third-party e-mail HTML safe to show: no scripts, forms, frames or
 * event handlers, only web/mail/phone links, and images limited to http(s)
 * and data: (the reader blocks the http(s) ones until the user asks). The
 * reader additionally renders the result in a sandboxed iframe with a strict
 * Content-Security-Policy, so this is one layer of two, not the only one.
 */
export function sanitizeEmailHtml(html: string, inlineImages: InlineImage[] = []): string {
  const withImages = inlineCidImages(html, inlineImages)
  const clean = sanitizeHtml(withImages, {
    allowedTags: [
      'a', 'abbr', 'b', 'big', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup',
      'dd', 'del', 'div', 'dl', 'dt', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img',
      'ins', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table',
      'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
    ],
    allowedAttributes: {
      '*': ['style', 'align', 'valign', 'bgcolor', 'dir', 'lang', 'width', 'height', 'title'],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      table: ['border', 'cellpadding', 'cellspacing', 'width', 'bgcolor', 'align'],
      td: ['colspan', 'rowspan', 'width', 'height', 'bgcolor', 'align', 'valign'],
      th: ['colspan', 'rowspan', 'width', 'height', 'bgcolor', 'align', 'valign'],
      font: ['color', 'face', 'size'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    // Drop script/style contents entirely instead of leaving the text behind.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'title', 'head'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
    },
  })
  // Inline CSS that can pull remote content or run behaviour is dropped.
  const safe = stripRiskyStyle(clean)
  return safe.length > MAX_HTML_CHARS ? safe.slice(0, MAX_HTML_CHARS) : safe
}

/** Strip anything in an inline style that could fetch or execute something. */
export function stripRiskyStyle(html: string): string {
  return html.replace(/style="([^"]*)"/gi, (_m, css: string) => {
    const safe = css
      .split(';')
      .filter((decl) => !/(url\s*\(|expression\s*\(|javascript:|behavior\s*:|-moz-binding|@import)/i.test(decl))
      .join(';')
    return `style="${safe}"`
  })
}
