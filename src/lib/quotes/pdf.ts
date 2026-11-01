import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { QUOTE_ISSUER } from './company'
import {
  formatBRL,
  formatDocument,
  formatLongDate,
  formatPhoneBR,
  formatQuantity,
  formatShortDate,
  lineTotal,
  pdfSafe,
} from './format'

export interface QuotePdfData {
  number: number
  issue_date: string
  client_legal_name: string | null
  client_trade_name: string | null
  client_document: string | null
  client_address: string | null
  client_address_number: string | null
  client_district: string | null
  client_city: string | null
  client_zip: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  seller_name: string | null
  seller_phone: string | null
  valid_until: string | null
  delivery_time: string | null
  payment_terms: string | null
  payment_due: string | null
  notes: string | null
}

export interface QuotePdfItem {
  quantity: number
  description: string
  ncm: string | null
  unit_price: number
}

// A4 in points; margins match the previous HTML model (12mm / 11mm).
const W = 595.28
const H = 841.89
const MX = 31
const MT = 34
const MB = 34
const CW = W - 2 * MX
const SIZE = 9
const LEAD = 12

const BLACK = rgb(0, 0, 0)

/**
 * Builds the quote PDF in the Ultratec model (header box, client box, items
 * table, total, conditions). `logoPng` is the logo file's bytes; without it
 * the header simply has no image.
 */
export async function buildQuotePdf(
  quote: QuotePdfData,
  items: QuotePdfItem[],
  logoPng?: Uint8Array,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo = logoPng ? await doc.embedPng(logoPng) : null

  let page = doc.addPage([W, H])
  let y = MT // distance from the top of the page

  const Y = (top: number) => H - top
  const text = (
    s: string,
    x: number,
    top: number,
    opts: { size?: number; bold?: boolean; align?: 'left' | 'right' | 'center'; width?: number } = {},
  ) => {
    const f = opts.bold ? bold : font
    const size = opts.size ?? SIZE
    const safe = pdfSafe(s)
    const w = f.widthOfTextAtSize(safe, size)
    let px = x
    if (opts.align === 'right') px = x + (opts.width ?? 0) - w
    if (opts.align === 'center') px = x + ((opts.width ?? 0) - w) / 2
    page.drawText(safe, { x: px, y: Y(top) - size, size, font: f, color: BLACK })
  }
  const rect = (x: number, top: number, w: number, h: number) =>
    page.drawRectangle({
      x,
      y: Y(top + h),
      width: w,
      height: h,
      borderColor: BLACK,
      borderWidth: 0.8,
    })
  const line = (x1: number, top1: number, x2: number, top2: number) =>
    page.drawLine({
      start: { x: x1, y: Y(top1) },
      end: { x: x2, y: Y(top2) },
      thickness: 0.8,
      color: BLACK,
    })

  /** Wrap `s` into lines no wider than `maxW`. */
  const wrap = (s: string, f: PDFFont, size: number, maxW: number): string[] => {
    const out: string[] = []
    for (const para of pdfSafe(s).split('\n')) {
      let cur = ''
      for (const word of para.split(/\s+/).filter(Boolean)) {
        // A word longer than the column is cut by characters.
        let w = word
        while (f.widthOfTextAtSize(w, size) > maxW && w.length > 1) {
          let cut = w.length - 1
          while (cut > 1 && f.widthOfTextAtSize(w.slice(0, cut), size) > maxW) cut--
          if (cur) {
            out.push(cur)
            cur = ''
          }
          out.push(w.slice(0, cut))
          w = w.slice(cut)
        }
        const trial = cur ? `${cur} ${w}` : w
        if (f.widthOfTextAtSize(trial, size) <= maxW) cur = trial
        else {
          if (cur) out.push(cur)
          cur = w
        }
      }
      out.push(cur)
    }
    return out
  }

  const ensure = (needed: number) => {
    if (y + needed > H - MB) {
      page = doc.addPage([W, H])
      y = MT
    }
  }

  // ---- Header box -------------------------------------------------------
  const headH = 112
  rect(MX, y, CW, headH)
  text(QUOTE_ISSUER.tradeName, MX, y + 8, { size: 21, bold: true, align: 'center', width: CW })
  let textX = MX + 10
  if (logo) {
    const lw = 112
    const lh = (logo.height / logo.width) * lw
    const maxH = headH - 46
    const scale = lh > maxH ? maxH / lh : 1
    page.drawImage(logo, {
      x: MX + 10,
      y: Y(y + 42 + lh * scale),
      width: lw * scale,
      height: lh * scale,
    })
    textX = MX + 10 + lw * scale + 14
  }
  const info = [
    QUOTE_ISSUER.legalName,
    `CNPJ: ${QUOTE_ISSUER.cnpj}`,
    QUOTE_ISSUER.address,
    QUOTE_ISSUER.city,
  ]
  // The issuer lines share the row with the contact block, so long ones wrap.
  const cx = MX + CW - 190
  info
    .flatMap((l) => wrap(l, font, 8.5, cx - textX - 10))
    .forEach((l, i) => text(l, textX, y + 40 + i * 12, { size: 8.5 }))
  const contactLines: [string, string][] = [
    ['Telefone:', QUOTE_ISSUER.phone],
    ['WhatsApp:', QUOTE_ISSUER.whatsapp],
    ['E-mail:', QUOTE_ISSUER.email],
  ]
  contactLines.forEach(([k, v], i) => {
    text(k, cx, y + 40 + i * 12, { size: 8.5 })
    text(v, cx + 46, y + 40 + i * 12, { size: 8.5 })
  })
  y += headH + 16

  // ---- Title row --------------------------------------------------------
  text(`ORÇAMENTO Nº: ${quote.number}`, MX + 2, y, { size: 11, bold: true })
  text(formatLongDate(quote.issue_date), MX, y, {
    size: 11,
    bold: true,
    align: 'right',
    width: CW - 2,
  })
  y += 22

  // ---- Client box -------------------------------------------------------
  const left: [string, string][] = [
    ['Razão Social:', quote.client_legal_name ?? ''],
    ['Nome Fantasia:', quote.client_trade_name ?? ''],
    ['CNPJ/CPF:', formatDocument(quote.client_document)],
    ['Endereço:', quote.client_address ?? ''],
    ['Bairro:', quote.client_district ?? ''],
    ['Cidade:', quote.client_city ?? ''],
    ['Contato:', quote.contact_name ?? ''],
    ['E-mail:', quote.contact_email ?? ''],
  ]
  const right: [string, string][] = [
    ['Número:', quote.client_address_number ?? ''],
    ['CEP:', quote.client_zip ?? ''],
    ['Telefone:', formatPhoneBR(quote.contact_phone)],
  ]
  const boxH = left.length * 13 + 10
  rect(MX, y, CW, boxH)
  const labelW = 62
  const leftValueMax = CW - 200 - labelW - 20
  left.forEach(([k, v], i) => {
    text(k, MX + 8, y + 5 + i * 13, { size: 8.5 })
    const shown = wrap(v, font, 8.5, leftValueMax)[0] ?? ''
    text(shown, MX + 8 + labelW + 4, y + 5 + i * 13, { size: 8.5 })
  })
  right.forEach(([k, v], i) => {
    text(k, MX + CW - 190, y + 5 + i * 13, { size: 8.5 })
    text(v, MX + CW - 190 + 44, y + 5 + i * 13, { size: 8.5 })
  })
  y += boxH + 14

  // ---- Intro ------------------------------------------------------------
  const intro =
    'Em atenção a sua consulta, apresentamos o nosso orçamento de preços, para aquisição ou manutenção dos materiais discriminados abaixo.'
  for (const l of wrap(intro, font, SIZE, CW - 80)) {
    text(l, MX + 40, y, { align: 'center', width: CW - 80 })
    y += LEAD
  }
  y += 8

  // ---- Items table ------------------------------------------------------
  const cols = [
    { label: 'Quantidade', w: CW * 0.11, align: 'center' as const },
    { label: 'Descrição', w: CW * 0.46, align: 'left' as const },
    { label: 'NCM', w: CW * 0.13, align: 'center' as const },
    { label: 'Preço', w: CW * 0.15, align: 'right' as const },
    { label: 'Total', w: CW * 0.15, align: 'right' as const },
  ]
  const xs: number[] = []
  cols.reduce((acc, c) => {
    xs.push(acc)
    return acc + c.w
  }, MX)

  const drawRow = (cells: string[], top: number, h: number, isHead: boolean) => {
    rect(MX, top, CW, h)
    cols.forEach((c, i) => {
      if (i > 0) line(xs[i], top, xs[i], top + h)
      const cell = cells[i]
      const pad = 5
      if (i === 1) {
        const lines = isHead ? [cell] : wrap(cell, font, SIZE, c.w - 2 * pad)
        lines.forEach((l, k) => text(l, xs[i] + pad, top + 4 + k * LEAD, { bold: isHead }))
      } else {
        text(cell, xs[i] + pad, top + 4, {
          bold: isHead,
          align: c.align === 'left' ? 'left' : c.align,
          width: c.w - 2 * pad,
        })
      }
    })
  }
  const headerCells = cols.map((c) => c.label)
  ensure(24 + 24)
  drawRow(headerCells, y, 20, true)
  y += 20
  for (const it of items) {
    const descLines = wrap(it.description, font, SIZE, cols[1].w - 10)
    const h = Math.max(1, descLines.length) * LEAD + 8
    if (y + h > H - MB) {
      page = doc.addPage([W, H])
      y = MT
      drawRow(headerCells, y, 20, true)
      y += 20
    }
    drawRow(
      [
        formatQuantity(it.quantity),
        it.description,
        it.ncm ?? '',
        formatBRL(it.unit_price),
        formatBRL(lineTotal(it)),
      ],
      y,
      h,
      false,
    )
    y += h
  }

  // ---- Total ------------------------------------------------------------
  const total = items.reduce((sum, it) => sum + lineTotal(it), 0)
  ensure(30)
  y += 10
  text(`Total:   ${formatBRL(total)}`, MX, y, { size: 10, bold: true, align: 'right', width: CW - 6 })
  y += 26

  // ---- Conditions -------------------------------------------------------
  const conds: [string, string][] = [
    ['Vendedor:', quote.seller_name ?? ''],
    ['Telefone:', formatPhoneBR(quote.seller_phone)],
    ['Validade:', formatShortDate(quote.valid_until)],
    ['Pagamento:', quote.payment_terms ?? ''],
  ]
  if (quote.payment_due) conds.push(['Venc. Pgto:', quote.payment_due])
  const condH = 22 + conds.length * 13 + 6
  ensure(condH + 10)
  const condW = CW * 0.62
  rect(MX, y, condW, condH)
  text('CONDIÇÕES', MX, y + 6, { bold: true, size: 10, align: 'center', width: condW })
  conds.forEach(([k, v], i) => {
    text(k, MX + 10, y + 24 + i * 13, { size: 8.5 })
    text(v, MX + 10 + 62, y + 24 + i * 13, { size: 8.5 })
  })
  const delivery = `Prazo de Entrega: ${quote.delivery_time ?? ''}`
  wrap(delivery, font, SIZE, CW - condW - 24).forEach((l, i) => {
    text(l, MX + condW + 20, y + 6 + i * LEAD)
  })
  y += condH + 12

  // ---- Notes ------------------------------------------------------------
  if (quote.notes?.trim()) {
    const lines = wrap(`Observações: ${quote.notes.trim()}`, font, SIZE, CW)
    for (const l of lines) {
      ensure(LEAD)
      text(l, MX, y)
      y += LEAD
    }
  }

  doc.setTitle(`Orçamento ${quote.number}`)
  doc.setAuthor(QUOTE_ISSUER.tradeName)
  return doc.save()
}

