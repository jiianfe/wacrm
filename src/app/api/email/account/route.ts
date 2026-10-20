import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import {
  loadEmailAccount,
  testImapLogin,
  toPublicAccount,
} from '@/lib/email/account'
import { cleanHost } from '@/lib/email/host-guard'

// The company mailbox (IMAP in, SMTP out). Admin-only: it holds a
// password. The table has no RLS policies, so every read and write goes
// through this route with the service role, and the password never
// leaves the server — GET returns only the public fields.
//
// Errors are machine codes the settings screen translates:
//   invalid_address | invalid_host | invalid_port | password_required |
//   auth | connect | host

function bad(code: string, status = 400) {
  return NextResponse.json({ error: code }, { status })
}

function asPort(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const row = await loadEmailAccount(supabaseAdmin(), ctx.accountId)
    return NextResponse.json({ account: row ? toPublicAccount(row) : null })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  let ctx
  try {
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return bad('invalid_address')

  const address = typeof body.address === 'string' ? body.address.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return bad('invalid_address')
  const username =
    typeof body.username === 'string' && body.username.trim() ? body.username.trim() : address

  const imapHost = cleanHost(typeof body.imap_host === 'string' ? body.imap_host : '')
  const smtpHost = cleanHost(typeof body.smtp_host === 'string' ? body.smtp_host : '')
  if (!imapHost || !smtpHost || imapHost.length > 253 || smtpHost.length > 253) {
    return bad('invalid_host')
  }
  const imapPort = asPort(body.imap_port)
  const smtpPort = asPort(body.smtp_port)
  if (!imapPort || !smtpPort) return bad('invalid_port')

  const db = supabaseAdmin()
  const existing = await loadEmailAccount(db, ctx.accountId)

  const typedPassword = typeof body.password === 'string' ? body.password : ''
  let password = typedPassword
  if (!password) {
    // Keeping the stored password is only possible when one exists.
    if (!existing) return bad('password_required')
    password = decrypt(existing.password_encrypted)
  }

  const imapSecure = body.imap_secure !== false
  const smtpSecure = body.smtp_secure !== false

  // Prove the credentials before saving, so a typo never ends up stored.
  const test = await testImapLogin({
    host: imapHost,
    port: imapPort,
    secure: imapSecure,
    username,
    password,
  })
  if (!test.ok) return bad(test.code, 422)

  // A different mailbox means the saved IMAP checkpoint no longer applies.
  const sameMailbox =
    existing &&
    existing.address === address &&
    existing.username === username &&
    existing.imap_host === imapHost

  const { data, error } = await db
    .from('email_accounts')
    .upsert(
      {
        account_id: ctx.accountId,
        address,
        username,
        password_encrypted: typedPassword ? encrypt(typedPassword) : existing!.password_encrypted,
        imap_host: imapHost,
        imap_port: imapPort,
        imap_secure: imapSecure,
        smtp_host: smtpHost,
        smtp_port: smtpPort,
        smtp_secure: smtpSecure,
        enabled: body.enabled !== false,
        last_error: null,
        ...(sameMailbox ? {} : { last_uid: null, uid_validity: null }),
      },
      { onConflict: 'account_id' },
    )
    .select('*')
    .single()
  if (error || !data) {
    console.error('[email-account] save failed:', error)
    return bad('internal', 500)
  }

  return NextResponse.json({ account: toPublicAccount(data) })
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin')
    const { error } = await supabaseAdmin()
      .from('email_accounts')
      .delete()
      .eq('account_id', ctx.accountId)
    if (error) return bad('internal', 500)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
