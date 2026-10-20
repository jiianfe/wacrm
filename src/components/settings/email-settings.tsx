"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, RefreshCw, Server, Unplug } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Company mailbox (IMAP in). Admin-only: it holds a password, which only
 * ever travels to /api/email/account (encrypted server-side) and is never
 * sent back. Saving proves the login first, so a typo never gets stored.
 */

interface PublicAccount {
  address: string;
  username: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  enabled: boolean;
  last_synced_at: string | null;
  last_error: string | null;
}

interface Form {
  address: string;
  username: string;
  password: string;
  imap_host: string;
  imap_port: string;
  imap_secure: boolean;
  smtp_host: string;
  smtp_port: string;
  smtp_secure: boolean;
  enabled: boolean;
}

// Hostinger mailboxes (the account's e-mail is hosted there).
const DEFAULTS: Form = {
  address: "",
  username: "",
  password: "",
  imap_host: "imap.hostinger.com",
  imap_port: "993",
  imap_secure: true,
  smtp_host: "smtp.hostinger.com",
  smtp_port: "465",
  smtp_secure: true,
  enabled: true,
};

const INPUT_CLASS =
  "bg-muted border-border text-foreground placeholder:text-muted-foreground";

const KNOWN_ERRORS = [
  "auth",
  "connect",
  "host",
  "tls",
  "invalid_address",
  "invalid_host",
  "invalid_port",
  "password_required",
  "internal",
];

export function EmailSettings() {
  const t = useTranslations("Settings.email");
  const locale = useLocale();
  const { canEditSettings, profileLoading } = useAuth();

  const [account, setAccount] = useState<PublicAccount | null>(null);
  const [form, setForm] = useState<Form>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const fromAccount = (a: PublicAccount): Form => ({
    address: a.address,
    username: a.username,
    password: "",
    imap_host: a.imap_host,
    imap_port: String(a.imap_port),
    imap_secure: a.imap_secure,
    smtp_host: a.smtp_host,
    smtp_port: String(a.smtp_port),
    smtp_secure: a.smtp_secure,
    enabled: a.enabled,
  });

  const load = useCallback(async () => {
    if (!canEditSettings) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await fetch("/api/email/account", { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as {
      account?: PublicAccount | null;
    } | null;
    if (res.ok) {
      setAccount(body?.account ?? null);
      if (body?.account) setForm(fromAccount(body.account));
    }
    setLoading(false);
  }, [canEditSettings]);

  useEffect(() => {
    if (profileLoading) return;
    load();
  }, [profileLoading, load]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const errorText = (code?: string) =>
    t(`errors.${KNOWN_ERRORS.includes(code ?? "") ? code : "internal"}`);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/email/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: form.address,
          username: form.username,
          password: form.password,
          imap_host: form.imap_host,
          imap_port: form.imap_port,
          imap_secure: form.imap_secure,
          smtp_host: form.smtp_host,
          smtp_port: form.smtp_port,
          smtp_secure: form.smtp_secure,
          enabled: form.enabled,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        account?: PublicAccount;
        error?: string;
      } | null;
      if (!res.ok || !body?.account) {
        toast.error(errorText(body?.error));
        return;
      }
      setAccount(body.account);
      setForm(fromAccount(body.account));
      toast.success(t("saved"));
    } catch {
      toast.error(errorText("connect"));
    } finally {
      setSaving(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/email/sync?force=1", { method: "POST" });
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        imported?: number;
        code?: string;
      } | null;
      if (body?.status === "ok") {
        toast.success(
          body.imported ? t("syncImported", { count: body.imported }) : t("syncNothing"),
        );
      } else if (body?.status === "busy") {
        toast.message(t("syncBusy"));
      } else {
        toast.error(errorText(body?.code));
      }
      await load();
    } catch {
      toast.error(errorText("connect"));
    } finally {
      setSyncing(false);
    }
  }

  async function handleRemove() {
    const res = await fetch("/api/email/account", { method: "DELETE" });
    if (!res.ok) {
      toast.error(errorText("internal"));
      return;
    }
    setAccount(null);
    setForm(DEFAULTS);
    setConfirmingRemove(false);
    toast.success(t("removed"));
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const cronCommand = `curl -s -H "x-cron-secret: YOUR_SECRET" ${origin}/api/email/sync`;

  return (
    <section className="max-w-3xl animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      {!canEditSettings && !profileLoading ? (
        <p className="text-sm text-muted-foreground">{t("adminOnly")}</p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("loading")}
        </div>
      ) : (
        <>
          {account && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <Mail className="size-4 text-primary" />
                  {account.address}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  {account.last_synced_at
                    ? t("lastSync", {
                        when: new Date(account.last_synced_at).toLocaleString(locale),
                      })
                    : t("neverSynced")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {account.last_error && (
                  <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {errorText(account.last_error)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSync}
                    disabled={syncing || !account.enabled}
                    className="border-border text-muted-foreground hover:bg-muted"
                  >
                    {syncing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    {syncing ? t("syncing") : t("syncNow")}
                  </Button>
                  {confirmingRemove ? (
                    <>
                      <Button type="button" variant="destructive" onClick={handleRemove}>
                        <Unplug className="size-4" />
                        {t("confirmRemove")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setConfirmingRemove(false)}
                        className="text-muted-foreground"
                      >
                        {t("cancel")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setConfirmingRemove(true)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Unplug className="size-4" />
                      {t("remove")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <Server className="size-4 text-primary" />
                  {account ? t("editTitle") : t("connectTitle")}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t("connectDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="em-address" className="text-muted-foreground">
                    {t("address")}
                  </Label>
                  <Input
                    id="em-address"
                    type="email"
                    value={form.address}
                    onChange={(e) => set("address", e.target.value)}
                    placeholder="contato@suaempresa.com.br"
                    autoComplete="off"
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="em-username" className="text-muted-foreground">
                    {t("username")}
                  </Label>
                  <Input
                    id="em-username"
                    value={form.username}
                    onChange={(e) => set("username", e.target.value)}
                    placeholder={form.address || t("usernamePlaceholder")}
                    autoComplete="off"
                    className={INPUT_CLASS}
                  />
                  <p className="text-xs text-muted-foreground">{t("usernameHint")}</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="em-password" className="text-muted-foreground">
                    {t("password")}
                  </Label>
                  <Input
                    id="em-password"
                    type="password"
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    placeholder={account ? t("passwordKeep") : ""}
                    autoComplete="new-password"
                    className={INPUT_CLASS}
                  />
                  <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
                </div>

                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">
                  {t("incomingTitle")}
                </p>
                <div className="grid gap-2">
                  <Label htmlFor="em-imap-host" className="text-muted-foreground">
                    {t("host")}
                  </Label>
                  <Input
                    id="em-imap-host"
                    value={form.imap_host}
                    onChange={(e) => set("imap_host", e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="em-imap-port" className="text-muted-foreground">
                    {t("port")}
                  </Label>
                  <Input
                    id="em-imap-port"
                    inputMode="numeric"
                    value={form.imap_port}
                    onChange={(e) => set("imap_port", e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>

                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">
                  {t("outgoingTitle")}
                </p>
                <div className="grid gap-2">
                  <Label htmlFor="em-smtp-host" className="text-muted-foreground">
                    {t("host")}
                  </Label>
                  <Input
                    id="em-smtp-host"
                    value={form.smtp_host}
                    onChange={(e) => set("smtp_host", e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="em-smtp-port" className="text-muted-foreground">
                    {t("port")}
                  </Label>
                  <Input
                    id="em-smtp-port"
                    inputMode="numeric"
                    value={form.smtp_port}
                    onChange={(e) => set("smtp_port", e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => set("enabled", e.target.checked)}
                    className="size-4 accent-[var(--primary)]"
                  />
                  {t("enabled")}
                </label>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  {t("hostingerHint")}
                </p>
              </CardContent>
            </Card>

            <Button
              type="submit"
              disabled={saving || !form.address.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? t("saving") : account ? t("update") : t("connect")}
            </Button>
          </form>

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">{t("cronTitle")}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t("cronDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs text-foreground">
                {cronCommand}
              </code>
              <p className="text-xs text-muted-foreground">{t("cronNote")}</p>
              <p className="text-xs text-muted-foreground">{t("receiveOnlyNote")}</p>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
