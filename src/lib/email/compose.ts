/** Helpers for writing an e-mail reply: addresses, subject, threading ids. */

export const MAX_RECIPIENTS = 20
export const MAX_ATTACHMENTS = 8
/** Total attachment size; most mail servers refuse anything over ~25 MB once encoded. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
export const MAX_SUBJECT_LENGTH = 300
export const MAX_BODY_LENGTH = 50_000

const ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/

/** Split "a@x.com, b@y.com; c@z.com" and keep only well-formed, de-duplicated addresses. */
export function parseAddressList(raw: string | null | undefined): { valid: string[]; invalid: string[] } {
  const valid: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const part of (raw ?? '').split(/[,;\n]+/)) {
    // Accept "Name <a@x.com>" by taking what is inside the brackets.
    const match = part.match(/<([^>]+)>/)
    const address = (match ? match[1] : part).trim()
    if (!address) continue
    const key = address.toLowerCase()
    if (!ADDRESS.test(address)) {
      invalid.push(address)
    } else if (!seen.has(key)) {
      seen.add(key)
      valid.push(address)
    }
  }
  return { valid, invalid }
}

/** "Re: subject", without stacking "Re: Re:". An empty subject becomes "Re:". */
export function replySubject(subject: string | null | undefined): string {
  const clean = (subject ?? '').replace(/[\r\n]+/g, ' ').trim()
  if (!clean) return 'Re:'
  return /^(re|res|enc|fwd?)\s*:/i.test(clean) ? clean : `Re: ${clean}`
}

/** The RFC 5322 Message-ID behind a stored `email:<id>` message id, or null when there is none to reply to. */
export function realMessageId(stored: string | null | undefined): string | null {
  if (!stored || !stored.startsWith('email:')) return null
  const id = stored.slice('email:'.length)
  // Mail that had no Message-ID got a made-up key; there is nothing to thread on.
  if (!id || id.startsWith('generated-')) return null
  return `<${id}>`
}

/** A subject safe for a header (no line breaks), cut to a sensible length. */
export function headerSafe(value: string, max = MAX_SUBJECT_LENGTH): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, max)
}

export const MAX_SIGNATURE_CHARS = 20_000

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Plain text → HTML paragraphs-by-line (what the agent typed, kept as typed). */
export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>')
}

/** The signature with `{{nome}}` replaced by the sender's name (escaped; empty when unknown). */
export function fillSignature(html: string, senderName: string | null): string {
  return html.replace(/\{\{\s*nome\s*\}\}/gi, () => escapeHtml(senderName ?? ''))
}

/** A readable plain-text version of sanitized HTML, for the text/plain alternative of an e-mail. */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim()
      return !text || text === href || `mailto:${text}` === href ? text || href : `${text} (${href})`
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Recipients of a reply to a received mail. "Reply" goes to the sender only;
 * "reply to all" also copies everyone else on the original To and Cc, minus
 * our own mailbox address and the sender.
 */
export function replyRecipients(input: {
  from: string | null | undefined
  to: string | null | undefined
  cc: string | null | undefined
  own: string | null | undefined
  all: boolean
}): { to: string; cc: string } {
  const own = (input.own ?? '').trim().toLowerCase()
  const sender = parseAddressList(input.from).valid[0] ?? ''
  const skip = new Set([own, sender.toLowerCase()].filter(Boolean))
  const cc: string[] = []
  if (input.all) {
    for (const address of [...parseAddressList(input.to).valid, ...parseAddressList(input.cc).valid]) {
      const key = address.toLowerCase()
      if (skip.has(key)) continue
      skip.add(key)
      cc.push(address)
    }
  }
  return { to: sender, cc: cc.join(', ') }
}
