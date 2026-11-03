import { createClient } from '@/lib/supabase/client'

const SW_URL = '/sw.js'

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

/** Browser can do Web Push (service worker + Push API + Notification). */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function keyToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const raw = atob((base64Url + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** This device's current push subscription, if any. */
export async function getDeviceSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration(SW_URL)
  return reg ? reg.pushManager.getSubscription() : null
}

/** Asks permission, subscribes this device and saves the subscription for the user. */
export async function enableDevicePush(accountId: string, userId: string): Promise<'ok' | 'denied' | 'no-key'> {
  if (!VAPID_PUBLIC_KEY) return 'no-key'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const reg = await navigator.serviceWorker.register(SW_URL)
  await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyToUint8Array(VAPID_PUBLIC_KEY),
    }))

  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('incomplete subscription')

  const supabase = createClient()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      account_id: accountId,
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 300),
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
  return 'ok'
}

/** Unsubscribes this device and removes its saved subscription. */
export async function disableDevicePush(): Promise<void> {
  const sub = await getDeviceSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => false)
  await createClient().from('push_subscriptions').delete().eq('endpoint', endpoint)
}
