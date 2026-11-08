import { createClient } from '@/lib/supabase/client'
import { buildDealDocumentPath } from '@/lib/deal-documents'
import { uploadAccountMedia } from '@/lib/storage/upload-media'
import type { Quote, QuoteItem } from '@/types'
import { buildQuotePdf } from './pdf'
import { quoteFileName } from './format'

const DEAL_BUCKET = 'deal-documents'
/** Public bucket Meta fetches outbound media from (migration 023). */
const CHAT_MEDIA_BUCKET = 'chat-media'

/** Builds the quote's PDF in the browser; named "Orçamento NNNN - CLIENTE.pdf". */
export async function renderQuotePdf(
  quote: Quote,
  items: QuoteItem[],
): Promise<{ bytes: Uint8Array; fileName: string }> {
  let logo: Uint8Array | undefined
  try {
    const res = await fetch('/logo-ultratec.png')
    if (res.ok) logo = new Uint8Array(await res.arrayBuffer())
  } catch {
    // No logo: the PDF is still valid.
  }
  const bytes = await buildQuotePdf(quote, items, logo)
  const fileName = quoteFileName(
    quote.number,
    quote.client_legal_name || quote.client_trade_name || quote.contact_name,
  )
  return { bytes, fileName }
}

const asPdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: 'application/pdf' })

/** Minimal shape of the File System Access handle (Chromium browsers). */
export interface PdfSaveHandle {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>
}

export const quotePdfFileName = (quote: Quote) =>
  quoteFileName(quote.number, quote.client_legal_name || quote.client_trade_name || quote.contact_name)

/**
 * Opens the browser's "Save as" dialog so the user picks the folder. Must run
 * straight from the click, before any slow work. Returns null when the browser
 * has no such dialog (the PDF then goes to the default Downloads folder), and
 * throws an AbortError when the user cancels.
 */
export async function pickQuotePdfHandle(quote: Quote): Promise<PdfSaveHandle | null> {
  const picker = (window as unknown as {
    showSaveFilePicker?: (opts: object) => Promise<PdfSaveHandle>
  }).showSaveFilePicker
  if (!picker) return null
  try {
    return await picker.call(window, {
      suggestedName: quotePdfFileName(quote),
      id: 'quote-pdf', // the browser remembers the last folder used with this id
      types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
    })
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err
    return null // e.g. no recent click: fall back to a normal download
  }
}

/**
 * Builds the quote's PDF in the browser and saves it as "Orçamento NNNN - CLIENTE.pdf",
 * into the chosen file when a handle is given, else as a normal download.
 */
export async function downloadQuotePdf(
  quote: Quote,
  items: QuoteItem[],
  handle?: PdfSaveHandle | null,
): Promise<void> {
  const { bytes, fileName } = await renderQuotePdf(quote, items)
  if (handle) {
    const writable = await handle.createWritable()
    await writable.write(asPdfBlob(bytes))
    await writable.close()
    return
  }
  const url = URL.createObjectURL(asPdfBlob(bytes))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Attaches the quote's PDF to its deal (category "quote"). A previous copy of
 * the same quote on that deal is replaced, so re-saving never piles up files.
 */
export async function attachQuotePdfToDeal(
  quote: Quote,
  items: QuoteItem[],
  dealId: string,
  author: { userId: string | null; name: string | null },
): Promise<void> {
  const supabase = createClient()
  const { bytes, fileName } = await renderQuotePdf(quote, items)
  const file = new File([asPdfBlob(bytes)], fileName, { type: 'application/pdf' })
  const path = buildDealDocumentPath(quote.account_id, dealId, fileName)

  const { error: upErr } = await supabase.storage
    .from(DEAL_BUCKET)
    .upload(path, file, { contentType: 'application/pdf', upsert: false })
  if (upErr) throw upErr

  const { data: old } = await supabase
    .from('deal_attachments')
    .select('id, storage_path')
    .eq('deal_id', dealId)
    .eq('category', 'quote')
    .eq('file_name', fileName.slice(0, 255))

  const { error: insErr } = await supabase.from('deal_attachments').insert({
    deal_id: dealId,
    account_id: quote.account_id,
    user_id: author.userId,
    author_name: author.name,
    file_name: fileName.slice(0, 255),
    storage_path: path,
    mime_type: 'application/pdf',
    size_bytes: file.size,
    category: 'quote',
  })
  if (insErr) {
    await supabase.storage.from(DEAL_BUCKET).remove([path])
    throw insErr
  }

  if (old?.length) {
    await supabase
      .from('deal_attachments')
      .delete()
      .in('id', old.map((o) => o.id as string))
    await supabase.storage.from(DEAL_BUCKET).remove(old.map((o) => o.storage_path as string))
  }
}

/** Sends the quote's PDF to the contact on WhatsApp as a document message. */
export async function sendQuotePdfViaWhatsApp(
  quote: Quote,
  items: QuoteItem[],
  contactId: string,
  caption: string,
): Promise<void> {
  const { bytes, fileName } = await renderQuotePdf(quote, items)
  const file = new File([asPdfBlob(bytes)], fileName, { type: 'application/pdf' })
  const { publicUrl } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file)
  const res = await fetch('/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contact_id: contactId,
      message_type: 'document',
      media_url: publicUrl,
      filename: fileName,
      content_text: caption,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || 'send failed')
  }
}
