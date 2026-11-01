import type { Quote, QuoteItem } from '@/types'
import { buildQuotePdf } from './pdf'
import { quoteFileName } from './format'

/** Builds the quote's PDF in the browser and saves it as "Orçamento NNNN - CLIENTE.pdf". */
export async function downloadQuotePdf(quote: Quote, items: QuoteItem[]): Promise<void> {
  let logo: Uint8Array | undefined
  try {
    const res = await fetch('/logo-ultratec.png')
    if (res.ok) logo = new Uint8Array(await res.arrayBuffer())
  } catch {
    // No logo: the PDF is still valid.
  }
  const bytes = await buildQuotePdf(quote, items, logo)
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = quoteFileName(
    quote.number,
    quote.client_legal_name || quote.client_trade_name || quote.contact_name,
  )
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
