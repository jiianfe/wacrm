/**
 * WhatsApp shows *text* in bold. Split a message into plain and bold parts so
 * the inbox can render it the same way, without the asterisks. A pair counts
 * only when the asterisks hug the text (no space just inside them) and stay on
 * one line, as in WhatsApp; anything else is left exactly as typed.
 */
export interface TextPart {
  text: string
  bold: boolean
}

const BOLD = /(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g

export function splitBold(input: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of input.matchAll(BOLD)) {
    const start = m.index ?? 0
    if (start > last) parts.push({ text: input.slice(last, start), bold: false })
    parts.push({ text: m[1], bold: true })
    last = start + m[0].length
  }
  if (last < input.length) parts.push({ text: input.slice(last), bold: false })
  return parts
}
