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
