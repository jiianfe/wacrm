import { NextResponse } from 'next/server'
import { simpleParser } from 'mailparser'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { imapClientForAccount, loadEmailAccount } from '@/lib/email/account'

/** Attachments are read from the mailbox, so a very large mail is refused. */
const MAX_SOURCE_BYTES = 30_000_000

/** A file name that is safe inside a Content-Disposition header. */
function headerFileName(name: string): { ascii: string; utf8: string } {
  const clean = name.replace(/[\r\n"\\/]/g, '_').slice(0, 180) || 'anexo'
  return { ascii: clean.replace(/[^\x20-\x7e]/g, '_'), utf8: encodeURIComponent(clean) }
}

/**
 * GET /api/email/attachment?message=<id>&index=<n>  (agent+)
 *
 * Downloads one attachment of a received e-mail. Nothing is stored in the
 * CRM: the original message is fetched from the mailbox (read-only) at the
 * moment of the click and the file is streamed back.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`email-attachment:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const url = new URL(request.url)
    const messageId = url.searchParams.get('message') ?? ''
    const index = Number(url.searchParams.get('index'))
    if (!messageId || !Number.isInteger(index) || index < 0) {
      return NextResponse.json({ error: 'invalid request' }, { status: 400 })
    }

    // RLS limits this read to the caller's account.
    const { data: message } = await supabase
      .from('messages')
      .select('id, channel, email_uid, email_uid_validity, email_attachments')
      .eq('id', messageId)
      .maybeSingle()
    const m = message as {
      channel: string | null
      email_uid: number | null
      email_uid_validity: number | null
      email_attachments: { index: number; filename: string }[] | null
    } | null
    if (!m || m.channel !== 'email' || m.email_uid == null) {
      return NextResponse.json({ error: 'attachment not found' }, { status: 404 })
    }
    if (!m.email_attachments?.some((a) => a.index === index)) {
      return NextResponse.json({ error: 'attachment not found' }, { status: 404 })
    }

    const account = await loadEmailAccount(supabaseAdmin(), accountId)
    if (!account) return NextResponse.json({ error: 'mailbox not configured' }, { status: 404 })

    const client = await imapClientForAccount(account)
    let source: Buffer | null = null
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        // The mailbox was renumbered since this mail was imported: the saved
        // position no longer points at it.
        if (m.email_uid_validity != null && Number(client.mailbox && client.mailbox.uidValidity) !== Number(m.email_uid_validity)) {
          return NextResponse.json({ error: 'attachment no longer available' }, { status: 410 })
        }
        const msg = await client.fetchOne(
          String(m.email_uid),
          { source: { maxLength: MAX_SOURCE_BYTES } },
          { uid: true },
        )
        source = msg && msg.source ? msg.source : null
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => undefined)
    }
    if (!source) return NextResponse.json({ error: 'attachment no longer available' }, { status: 404 })

    const parsed = await simpleParser(source)
    const file = parsed.attachments[index]
    if (!file) return NextResponse.json({ error: 'attachment not found' }, { status: 404 })

    const name = headerFileName(file.filename || 'anexo')
    return new NextResponse(new Uint8Array(file.content), {
      headers: {
        // Always a download, never rendered inside the CRM's own origin.
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${name.ascii}"; filename*=UTF-8''${name.utf8}`,
        'Content-Length': String(file.content.length),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
