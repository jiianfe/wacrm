import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadEmailAccount, type EmailAccountRow } from '@/lib/email/account'
import { syncEmailAccount } from '@/lib/email/sync'

// E-mail sync triggers.
//
//   GET  — scheduled pinger (Hostinger cron job). Syncs every enabled
//          mailbox. Needs the shared secret in `x-cron-secret`; the
//          secret is EMAIL_CRON_SECRET, falling back to the existing
//          AUTOMATION_CRON_SECRET so no new variable is required.
//   POST — the inbox page while it is open (and the "Sync now" button).
//          Signed-in agents sync their own account's mailbox, throttled
//          so a busy inbox doesn't hammer the mail server.

/** Stop starting new accounts after this long (host request limits). */
const CRON_BUDGET_MS = 45_000
/** A POST within this window of the last sync is a no-op. */
const POST_THROTTLE_MS = 20_000

export async function GET(request: Request) {
  const expected = process.env.EMAIL_CRON_SECRET || process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()
  const { data, error } = await db.from('email_accounts').select('*').eq('enabled', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const started = Date.now()
  let imported = 0
  let accounts = 0
  for (const row of (data ?? []) as EmailAccountRow[]) {
    if (Date.now() - started > CRON_BUDGET_MS) break
    const result = await syncEmailAccount(db, row)
    accounts += 1
    if (result.status === 'ok') imported += result.imported
  }
  return NextResponse.json({ accounts, imported })
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const db = supabaseAdmin()
  const row = await loadEmailAccount(db, ctx.accountId)
  if (!row || !row.enabled) return NextResponse.json({ status: 'none' })

  const force = new URL(request.url).searchParams.get('force') === '1'
  const last = row.last_synced_at ? new Date(row.last_synced_at).getTime() : 0
  if (!force && Date.now() - last < POST_THROTTLE_MS) {
    return NextResponse.json({ status: 'recent' })
  }

  const result = await syncEmailAccount(db, row)
  return NextResponse.json(result)
}
