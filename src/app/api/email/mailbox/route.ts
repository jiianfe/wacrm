import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadEmailAccount } from '@/lib/email/account'

/**
 * GET /api/email/mailbox  (agent+)
 *
 * The company mailbox's address only (never the password or server data),
 * so the reply box can leave it out of "reply to all".
 */
export async function GET() {
  try {
    const ctx = await requireRole('agent')
    const row = await loadEmailAccount(supabaseAdmin(), ctx.accountId)
    return NextResponse.json({ address: row?.address ?? null })
  } catch (err) {
    return toErrorResponse(err)
  }
}
