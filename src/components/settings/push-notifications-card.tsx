'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, CircleAlert, Loader2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  VAPID_PUBLIC_KEY,
  disableDevicePush,
  enableDevicePush,
  getDeviceSubscription,
  pushSupported,
} from '@/lib/push/client';

/**
 * "Alerts with the app closed" (Web Push). Subscribes THIS device; whether
 * the person is actually notified is decided by an admin in the members tab.
 */
export function PushNotificationsCard({ className }: { className?: string }) {
  const t = useTranslations('Settings.pushNotifications');
  const { accountId, user } = useAuth();

  const [supported, setSupported] = useState(true);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    const ok = pushSupported();
    setSupported(ok);
    if (!ok) return;
    const sub = await getDeviceSubscription().catch(() => null);
    setActive(!!sub && Notification.permission === 'granted');
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function onToggle(next: boolean) {
    if (!accountId || !user) return;
    setBusy(true);
    try {
      if (next) {
        const result = await enableDevicePush(accountId, user.id);
        if (result === 'denied') toast.error(t('denied'));
        else if (result === 'no-key') toast.error(t('notConfigured'));
        else toast.success(t('enabled'));
      } else {
        await disableDevicePush();
        toast.success(t('disabled'));
      }
    } catch (err) {
      console.error('[push] toggle failed:', err);
      toast.error(t('failed'));
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data?.error ?? t('failed'));
      else if (!data.sent) toast.error(t('testNone'));
      else toast.success(t('testSent'));
    } catch {
      toast.error(t('failed'));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Smartphone className="size-4 text-muted-foreground" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleAlert className="size-4 shrink-0" />
            {t('unsupported')}
          </p>
        ) : !VAPID_PUBLIC_KEY ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleAlert className="size-4 shrink-0" />
            {t('notConfigured')}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t('toggleLabel')}</p>
                <p className="text-xs text-muted-foreground">{t('toggleDesc')}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                <Switch
                  checked={active}
                  onCheckedChange={(v) => void onToggle(v)}
                  disabled={busy}
                  aria-label={t('toggleLabel')}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('adminHint')}</p>
            <Button type="button" variant="outline" size="sm" onClick={sendTest} disabled={!active || testing}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}
              {t('sendTest')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
