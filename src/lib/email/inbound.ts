import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParsedMail } from 'mailparser'

import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { findOrCreateConversationRow } from '@/lib/whatsapp/resolve-conversation'

const MAX_BODY_CHARS = 20_000
const MAX_SUBJECT_CHARS = 300

export interface InboundEmailResult {
  /** True when a new message row was written (false: duplicate or skipped). */
  inserted: boolean
  skipped?: 'no_sender' | 'own_address' | 'automatic'
}

/** Escape `%`, `_` and `\` so an address can be used with ILIKE as an exact match. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** Bounces and mailing-list/automatic mail are not customer messages. */
function isAutomatic(parsed: ParsedMail, fromAddress: string): boolean {
  if (/^(mailer-daemon|postmaster)@/i.test(fromAddress)) return true
  const auto = parsed.headers.get('auto-submitted')
  if (typeof auto === 'string' && auto.toLowerCase() !== 'no') return true
  const precedence = parsed.headers.get('precedence')
  if (typeof precedence === 'string' && /^(bulk|junk|list)$/i.test(precedence.trim())) return true
  return false
}

function stableMessageId(parsed: ParsedMail, from: string): string {
  const raw = parsed.messageId?.trim().replace(/^<|>$/g, '')
  if (raw) return `email:${raw}`
  const digest = createHash('sha1')
    .update(`${from}|${parsed.date?.toISOString() ?? ''}|${parsed.subject ?? ''}`)
    .digest('hex')
  return `email:generated-${digest}`
}

/**
 * Store one received e-mail: find (or create) the contact by sender
 * address, put the message in that contact's single conversation, bump
 * unread and re-open the thread — the same effects as an inbound
 * WhatsApp message, minus everything WhatsApp-specific (flows,
 * automations and AI auto-replies only run from the WhatsApp webhook).
 */
export async function ingestInboundEmail(
  db: SupabaseClient,
  input: {
    accountId: string
    ownerUserId: string
    mailboxAddress: string
    parsed: ParsedMail
  },
): Promise<InboundEmailResult> {
  const { accountId, ownerUserId, mailboxAddress, parsed } = input

  const sender = parsed.from?.value?.[0]
  const fromAddress = sender?.address?.trim().toLowerCase()
  if (!fromAddress) return { inserted: false, skipped: 'no_sender' }
  if (fromAddress === mailboxAddress.trim().toLowerCase()) {
    return { inserted: false, skipped: 'own_address' }
  }
  if (isAutomatic(parsed, fromAddress)) return { inserted: false, skipped: 'automatic' }

  // ---- contact (by e-mail address) ------------------------------
  let contactId: string | null = null
  const { data: existing } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .ilike('email', escapeLike(fromAddress))
    .order('created_at', { ascending: true })
    .limit(1)
  if (existing && existing.length > 0) {
    contactId = existing[0].id as string
  } else {
    const { data: created, error } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        // Contacts without a phone are allowed: the unique phone index
        // ignores empty numbers (migration 022).
        phone: '',
        name: sender?.name?.trim() || fromAddress,
        email: fromAddress,
      })
      .select('id')
      .single()
    if (error || !created) {
      if (!isUniqueViolation(error)) throw error ?? new Error('contact insert failed')
      const { data: raced } = await db
        .from('contacts')
        .select('id')
        .eq('account_id', accountId)
        .ilike('email', escapeLike(fromAddress))
        .limit(1)
      if (!raced || raced.length === 0) throw error
      contactId = raced[0].id as string
    } else {
      contactId = created.id as string
    }
  }

  // ---- conversation ---------------------------------------------
  const conversationId = await findOrCreateConversationRow(
    db,
    accountId,
    contactId,
    ownerUserId,
  )

  // ---- message ---------------------------------------------------
  const subject = clip((parsed.subject ?? '').trim(), MAX_SUBJECT_CHARS)
  const body = clip((parsed.text ?? '').trim(), MAX_BODY_CHARS)
  const now = Date.now()
  // A bogus Date header must not push the message into the future.
  const sentAt = parsed.date && parsed.date.getTime() <= now ? parsed.date : new Date(now)
  const toList = (Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : [])
    .flatMap((t) => t.value.map((v) => v.address))
    .filter(Boolean)
    .join(', ')

  const { data: insertedRows, error: msgError } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: conversationId,
        sender_type: 'customer',
        content_type: 'text',
        content_text: body,
        message_id: stableMessageId(parsed, fromAddress),
        status: 'delivered',
        created_at: sentAt.toISOString(),
        channel: 'email',
        email_subject: subject || null,
        email_from: fromAddress,
        email_to: toList || null,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id')
  if (msgError) throw msgError
  if (!insertedRows || insertedRows.length === 0) return { inserted: false }

  const preview = subject || body.slice(0, 80) || fromAddress
  await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversationId,
    p_last_message_text: `✉ ${preview}`,
  })

  const { data: conv } = await db
    .from('conversations')
    .select('id, status')
    .eq('id', conversationId)
    .maybeSingle()
  if (conv) await reopenClosedConversation(db, conv as { id: string; status?: string | null })

  return { inserted: true }
}
