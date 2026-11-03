import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { sendToSubscriptions } from '@/lib/push/send'

/**
 * POST /api/push/test  (any member)
 *
 * Sends a test push to the caller's own devices, so they can confirm alerts
 * arrive. Returns { sent } — 0 means no device is subscribed or push is not
 * configured on the server.
 */
export async function POST() {
  try {
    const { supabase, userId } = await requireRole('viewer')

    const limit = checkRateLimit(`push-test:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    // RLS limits this select to the caller's own rows.
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId)

    const sent = await sendToSubscriptions(supabaseAdmin(), subs ?? [], {
      title: 'Ultratec CRM',
      body: 'Teste de notificação: está funcionando.',
      tag: 'wacrm-push-test',
      url: '/settings?tab=profile',
    })
    return NextResponse.json({ sent })
  } catch (err) {
    return toErrorResponse(err)
  }
}
