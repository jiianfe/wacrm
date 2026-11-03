import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isPushRecipient } from './recipients'

export interface PushPayload {
  title: string
  body: string
  /** One alert per conversation: a newer push replaces the older one. */
  tag: string
  /** Where a tap should land, e.g. /inbox?conversation=<id>. */
  url: string
}

let configured = false

/** True once the VAPID keys are present; push is silently skipped otherwise. */
function configure(): boolean {
  if (configured) return true
  const pub = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contato@ultratecextintores.com.br', pub, priv)
  configured = true
  return true
}

interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

/** Sends to each subscription; endpoints the push service reports gone are deleted. */
export async function sendToSubscriptions(
  admin: SupabaseClient,
  subs: SubscriptionRow[],
  payload: PushPayload,
): Promise<number> {
  if (!subs.length || !configure()) return 0
  const body = JSON.stringify(payload)
  const dead: string[] = []
  let sent = 0
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 },
        )
        sent += 1
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) dead.push(s.id)
        else console.error('[push] send failed:', status ?? err)
      }
    }),
  )
  if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead)
  return sent
}

/** Push for a new customer message, to every member the admin opted in. */
export async function pushForInboundMessage(
  admin: SupabaseClient,
  accountId: string,
  payload: PushPayload,
): Promise<void> {
  if (!configure()) return
  const { data: members } = await admin
    .from('profiles')
    .select('user_id, account_role, push_notify')
    .eq('account_id', accountId)
  const userIds = ((members ?? []) as { user_id: string; account_role: string; push_notify: boolean | null }[])
    .filter((m) => isPushRecipient(m.push_notify, m.account_role))
    .map((m) => m.user_id)
  if (!userIds.length) return

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', userIds)
  await sendToSubscriptions(admin, (subs ?? []) as SubscriptionRow[], payload)
}
