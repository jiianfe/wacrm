import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadEmailAccount, smtpTransportForAccount } from '@/lib/email/account'
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_BODY_LENGTH,
  MAX_RECIPIENTS,
  fillSignature,
  headerSafe,
  htmlToText,
  parseAddressList,
  realMessageId,
  textToHtml,
} from '@/lib/email/compose'

export const maxDuration = 60

interface Attachment {
  filename: string
  contentType: string
  content: Buffer
}

const fail = (error: string, status: number, code?: string) =>
  NextResponse.json({ error, code }, { status })

/**
 * POST /api/email/send  (agent+, multipart/form-data)
 *
 *   conversation_id, to, cc?, subject, body, signature? ("1"),
 *   reply_to_message_id? (the received message this answers),
 *   files (0..n uploads), crm_attachment_ids (JSON array of deal_attachments ids)
 *
 * Sends through the account's own SMTP server, threads the mail onto the
 * message it answers (In-Reply-To / References) and records it in the
 * conversation. Nothing is stored for the attachments except their names.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`email-send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const form = await request.formData().catch(() => null)
    if (!form) return fail('invalid request', 400)
    const text = (key: string) => {
      const v = form.get(key)
      return typeof v === 'string' ? v : ''
    }

    const conversationId = text('conversation_id')
    const subject = headerSafe(text('subject'))
    const rawBody = text('body').replace(/\r\n/g, '\n').trim()
    if (!conversationId) return fail('conversation required', 400)
    if (!rawBody) return fail('Escreva a mensagem antes de enviar.', 400, 'empty_body')
    if (rawBody.length > MAX_BODY_LENGTH) return fail('Mensagem longa demais.', 400, 'body_too_long')

    const to = parseAddressList(text('to'))
    const cc = parseAddressList(text('cc'))
    if (to.invalid.length || cc.invalid.length) {
      return fail(`Endereço inválido: ${[...to.invalid, ...cc.invalid].join(', ')}`, 400, 'invalid_address')
    }
    if (to.valid.length === 0) return fail('Informe o destinatário.', 400, 'no_recipient')
    if (to.valid.length + cc.valid.length > MAX_RECIPIENTS) {
      return fail('Destinatários demais.', 400, 'too_many_recipients')
    }

    // RLS limits this to the caller's account.
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!conversation) return fail('conversation not found', 404)
    const contactId = (conversation as { contact_id: string | null }).contact_id

    const account = await loadEmailAccount(supabaseAdmin(), accountId)
    if (!account || !account.enabled) return fail('Caixa de e-mail não configurada.', 404, 'no_mailbox')

    // ---- threading: answer a specific received mail, or the latest one ----
    const replyTo = text('reply_to_message_id')
    let parentQuery = supabase
      .from('messages')
      .select('message_id')
      .eq('conversation_id', conversationId)
      .eq('channel', 'email')
      .eq('sender_type', 'customer')
    parentQuery = replyTo
      ? parentQuery.eq('id', replyTo)
      : parentQuery.order('created_at', { ascending: false }).limit(1)
    const { data: parentRows } = await parentQuery
    const parentId = realMessageId((parentRows as { message_id: string | null }[] | null)?.[0]?.message_id)

    // ---- attachments ----
    const attachments: Attachment[] = []
    let total = 0
    const add = (a: Attachment) => {
      total += a.content.length
      attachments.push(a)
    }
    for (const entry of form.getAll('files')) {
      if (typeof entry === 'string' || entry.size === 0) continue
      add({
        filename: headerSafe(entry.name || 'anexo', 180) || 'anexo',
        contentType: entry.type || 'application/octet-stream',
        content: Buffer.from(await entry.arrayBuffer()),
      })
      if (attachments.length > MAX_ATTACHMENTS || total > MAX_ATTACHMENT_BYTES) break
    }

    let crmIds: string[] = []
    try {
      const parsed = JSON.parse(text('crm_attachment_ids') || '[]')
      if (Array.isArray(parsed)) crmIds = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      return fail('invalid request', 400)
    }
    if (crmIds.length && attachments.length + crmIds.length <= MAX_ATTACHMENTS && total <= MAX_ATTACHMENT_BYTES) {
      const { data: docs } = await supabase
        .from('deal_attachments')
        .select('id, deal_id, file_name, storage_path, mime_type')
        .in('id', crmIds)
      const rows = (docs ?? []) as {
        id: string
        deal_id: string
        file_name: string
        storage_path: string
        mime_type: string | null
      }[]
      // Only documents of this customer's deals may go to this customer.
      const { data: deals } = contactId
        ? await supabase
            .from('deals')
            .select('id')
            .eq('contact_id', contactId)
            .in(
              'id',
              rows.map((r) => r.deal_id),
            )
        : { data: [] }
      const allowed = new Set(((deals ?? []) as { id: string }[]).map((d) => d.id))
      for (const doc of rows) {
        if (!allowed.has(doc.deal_id)) return fail('Documento não pertence a este cliente.', 403, 'document_forbidden')
        const { data: file, error } = await supabase.storage.from('deal-documents').download(doc.storage_path)
        if (error || !file) return fail(`Não consegui ler o documento ${doc.file_name}.`, 500, 'document_unreadable')
        add({
          filename: doc.file_name,
          contentType: doc.mime_type || 'application/octet-stream',
          content: Buffer.from(await file.arrayBuffer()),
        })
      }
    }
    if (attachments.length > MAX_ATTACHMENTS) return fail('Anexos demais.', 400, 'too_many_attachments')
    if (total > MAX_ATTACHMENT_BYTES) {
      return fail('Anexos grandes demais (máximo 15 MB no total).', 400, 'attachments_too_big')
    }

    // ---- body (+ optional signature) ----
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
    const senderName = (profile as { full_name: string | null } | null)?.full_name?.trim() || null
    // With a formatted signature configured the mail goes out as HTML (plus a
    // plain-text twin); without one it stays plain text with a short signature.
    const wantSignature = text('signature') === '1'
    const signatureHtml =
      wantSignature && account.signature_html ? fillSignature(account.signature_html, senderName) : ''
    let body = rawBody
    let html: string | null = null
    if (signatureHtml) {
      html =
        `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a">${textToHtml(rawBody)}` +
        `<br><br>-- <br>${signatureHtml}</div>`
      body = `${rawBody}\n\n-- \n${htmlToText(signatureHtml)}`
    } else if (wantSignature) {
      body = `${rawBody}\n\n-- \n${senderName ? `${senderName}\n` : ''}Ultratec Extintores`
    }

    // ---- send ----
    const transport = await smtpTransportForAccount(account)
    let messageId: string
    try {
      const info = await transport.sendMail({
        from: senderName ? { name: senderName, address: account.address } : account.address,
        to: to.valid,
        cc: cc.valid.length ? cc.valid : undefined,
        subject,
        text: body,
        ...(html ? { html } : {}),
        ...(parentId ? { inReplyTo: parentId, references: parentId } : {}),
        attachments: attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          content: a.content,
        })),
      })
      messageId = String(info.messageId || '').replace(/^<|>$/g, '')
    } catch (err) {
      const e = err as { code?: string; responseCode?: number }
      console.error('[email-send] SMTP failed:', e.code, e.responseCode)
      if (e.code === 'EAUTH') {
        return fail('O servidor recusou o login do e-mail. Confira a senha em Configurações.', 502, 'smtp_auth')
      }
      if (e.responseCode && e.responseCode >= 550) {
        return fail('O servidor recusou o envio (endereço ou conteúdo).', 502, 'smtp_rejected')
      }
      return fail('Não consegui enviar o e-mail agora. Tente de novo.', 502, 'smtp_failed')
    } finally {
      transport.close()
    }

    // ---- record ----
    const sentAt = new Date().toISOString()
    const { data: saved, error: saveError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_id: userId,
        content_type: 'text',
        content_text: body,
        message_id: messageId ? `email:${messageId}` : `email:sent-${crypto.randomUUID()}`,
        status: 'sent',
        channel: 'email',
        email_subject: subject || null,
        email_from: account.address,
        email_from_name: senderName,
        email_to: to.valid.join(', '),
        email_cc: cc.valid.length ? cc.valid.join(', ') : null,
        email_attachments: attachments.length
          ? attachments.map((a, index) => ({
              index,
              filename: a.filename,
              contentType: a.contentType,
              size: a.content.length,
            }))
          : null,
        email_has_html: !!html,
      })
      .select()
      .single()
    if (saveError || !saved) {
      console.error('[email-send] sent but not saved:', saveError?.message)
      return fail('O e-mail foi enviado, mas não consegui registrá-lo na conversa.', 500, 'sent_not_saved')
    }

    if (html) {
      // Kept so the reader shows the mail as it went out; the text body is already saved.
      const { error: bodyError } = await supabaseAdmin()
        .from('email_message_bodies')
        .insert({ message_id: (saved as { id: string }).id, account_id: accountId, html })
      if (bodyError) console.error('[email-send] html body not saved:', bodyError.message)
    }

    await supabase
      .from('conversations')
      .update({ last_message_text: `✉ ${subject || body.slice(0, 80)}`, last_message_at: sentAt, updated_at: sentAt })
      .eq('id', conversationId)

    return NextResponse.json({ message: saved })
  } catch (err) {
    return toErrorResponse(err)
  }
}
