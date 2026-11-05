import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadEmailAccount } from '@/lib/email/account'
import { MAX_SIGNATURE_CHARS } from '@/lib/email/compose'
import { sanitizeEmailHtml } from '@/lib/email/html'

// The company's e-mail signature (formatted HTML). Admin-only, like the
// rest of the mailbox settings. What is saved has been through the same
// sanitizer as received mail: no scripts, frames, event handlers or
// risky CSS, only web/mail/phone links.

const bad = (code: string, status = 400) => NextResponse.json({ error: code }, { status })

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const row = await loadEmailAccount(supabaseAdmin(), ctx.accountId)
    return NextResponse.json({ has_mailbox: !!row, signature_html: row?.signature_html ?? '' })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const raw = body && typeof body.signature_html === 'string' ? body.signature_html : null
    if (raw === null) return bad('invalid')
    if (raw.length > MAX_SIGNATURE_CHARS * 3) return bad('too_long')

    const clean = raw.trim() ? sanitizeEmailHtml(raw).trim() : ''
    if (clean.length > MAX_SIGNATURE_CHARS) return bad('too_long')

    const { data, error } = await supabaseAdmin()
      .from('email_accounts')
      .update({ signature_html: clean || null })
      .eq('account_id', ctx.accountId)
      .select('account_id')
    if (error) {
      console.error('[email-signature] save failed:', error.message)
      return bad('internal', 500)
    }
    if (!data || data.length === 0) return bad('no_mailbox', 404)
    return NextResponse.json({ signature_html: clean })
  } catch (err) {
    return toErrorResponse(err)
  }
}
