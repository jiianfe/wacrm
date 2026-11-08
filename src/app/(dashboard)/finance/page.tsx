"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus, Search } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { formatBRL, formatShortDate } from "@/lib/quotes/format";
import {
  PAYMENT_METHODS,
  RECEIVABLE_STATUSES,
  cashOnHand,
  monthStart,
  receivedByMethod,
  summarize,
  todayFortaleza,
  type PaymentRow,
  type ReceivableRow,
} from "@/lib/finance/finance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReceivableDetail } from "@/components/finance/receivable-detail";
import { ReceivableDialog } from "@/components/finance/receivable-dialog";
import { StatusBadge } from "@/components/finance/status-badge";

type StatusFilter = "pending" | "all" | (typeof RECEIVABLE_STATUSES)[number];
type PaymentLite = Pick<PaymentRow, "id" | "amount" | "method" | "paid_at" | "deposited_at">;

const SELECT =
  "rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "red" | "green" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          "mt-1 text-xl font-semibold " +
          (tone === "red" ? "text-red-600 dark:text-red-300" : tone === "green" ? "text-emerald-600 dark:text-emerald-300" : "text-foreground")
        }
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function FinancePage() {
  const t = useTranslations("Finance");
  const isAdmin = useCan("edit-settings");
  const { profileLoading } = useAuth();

  const [rows, setRows] = useState<ReceivableRow[]>([]);
  const [monthPayments, setMonthPayments] = useState<PaymentLite[]>([]);
  const [cashPayments, setCashPayments] = useState<PaymentLite[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState<StatusFilter>("pending");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const today = todayFortaleza();

  const load = useCallback(async () => {
    const supabase = createClient();
    const [recv, month, cash] = await Promise.all([
      supabase.from("receivable_balances").select("*").order("due_date", { ascending: true }).limit(2000),
      supabase
        .from("receivable_payments")
        .select("id, amount, method, paid_at, deposited_at")
        .gte("paid_at", monthStart(todayFortaleza())),
      supabase
        .from("receivable_payments")
        .select("id, amount, method, paid_at, deposited_at")
        .eq("method", "cash")
        .is("deposited_at", null),
    ]);
    if (recv.error) {
      toast.error(t("loadFailed"));
      setLoading(false);
      return;
    }
    const list = ((recv.data ?? []) as ReceivableRow[]).map((r) => ({
      ...r,
      amount: Number(r.amount),
      paid_amount: Number(r.paid_amount),
      balance: Number(r.balance),
    }));
    setRows(list);
    const norm = (d: unknown) => ((d ?? []) as PaymentLite[]).map((p) => ({ ...p, amount: Number(p.amount) }));
    setMonthPayments(norm(month.data));
    setCashPayments(norm(cash.data));

    // Customer names for the list.
    const contactIds = [...new Set(list.map((r) => r.contact_id).filter((x): x is string => !!x))];
    const companyIds = [...new Set(list.map((r) => r.company_id).filter((x): x is string => !!x))];
    const [c, co] = await Promise.all([
      contactIds.length ? supabase.from("contacts").select("id, name").in("id", contactIds) : { data: [] },
      companyIds.length ? supabase.from("companies").select("id, legal_name, trade_name").in("id", companyIds) : { data: [] },
    ]);
    const map: Record<string, string> = {};
    for (const x of (c.data ?? []) as { id: string; name: string | null }[]) map[x.id] = x.name ?? "";
    for (const x of (co.data ?? []) as { id: string; legal_name: string | null; trade_name: string | null }[]) {
      map[x.id] = x.trade_name || x.legal_name || "";
    }
    setNames(map);
    setLoading(false);
  }, [t]);

  useEffect(() => {
    if (profileLoading || !isAdmin) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [profileLoading, isAdmin, load]);

  const customerOf = useCallback(
    (r: ReceivableRow) => (r.company_id && names[r.company_id]) || (r.contact_id && names[r.contact_id]) || "",
    [names],
  );

  const summary = useMemo(() => summarize(rows, today), [rows, today]);
  const received = useMemo(() => receivedByMethod(monthPayments), [monthPayments]);
  const receivedTotal = received.pix + received.boleto + received.cash + received.other;
  const cash = useMemo(() => cashOnHand(cashPayments), [cashPayments]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status === "pending") {
        if (!(r.status === "open" || r.status === "partial" || r.status === "overdue")) return false;
      } else if (status !== "all" && r.status !== status) return false;
      if (from && r.due_date < from) return false;
      if (to && r.due_date > to) return false;
      if (!term) return true;
      return r.description.toLowerCase().includes(term) || customerOf(r).toLowerCase().includes(term);
    });
  }, [rows, status, search, from, to, customerOf]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  if (!profileLoading && !isAdmin) {
    return <p className="p-6 text-sm text-muted-foreground">{t("restricted")}</p>;
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button type="button" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          {t("newReceivable")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Card label={t("cards.dueWeek")} value={formatBRL(summary.due7)} />
        <Card label={t("cards.dueMonth")} value={formatBRL(summary.due30)} />
        <Card
          label={t("cards.overdue")}
          value={formatBRL(summary.overdueAmount)}
          hint={t("cards.count", { count: summary.overdueCount })}
          tone={summary.overdueCount ? "red" : undefined}
        />
        <Card
          label={t("cards.receivedMonth")}
          value={formatBRL(receivedTotal)}
          hint={PAYMENT_METHODS.filter((m) => received[m] > 0)
            .map((m) => `${t(`method.${m}`)} ${formatBRL(received[m])}`)
            .join(" · ")}
          tone="green"
        />
        <Card label={t("cards.cashOnHand")} value={formatBRL(cash)} hint={t("cards.cashHint")} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("filters.search")}
            className="border-border bg-muted pl-9 text-sm"
          />
        </div>
        <select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label={t("filters.status")}>
          <option value="pending">{t("filters.pending")}</option>
          <option value="all">{t("filters.all")}</option>
          {RECEIVABLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          {t("filters.from")}
          <input type="date" className={SELECT} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          {t("filters.to")}
          <input type="date" className={SELECT} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(from || to || search || status !== "pending") && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline hover:text-foreground"
            onClick={() => {
              setFrom("");
              setTo("");
              setSearch("");
              setStatus("pending");
            }}
          >
            {t("filters.clear")}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("table.client")}</th>
              <th className="px-3 py-2 font-medium">{t("table.description")}</th>
              <th className="px-3 py-2 font-medium">{t("table.due")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("table.amount")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("table.balance")}</th>
              <th className="px-3 py-2 font-medium">{t("table.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-4 animate-spin" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  {t("table.empty")}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} onClick={() => setSelectedId(r.id)} className="cursor-pointer hover:bg-muted/40">
                  <td className="max-w-48 truncate px-3 py-2">{customerOf(r) || "—"}</td>
                  <td className="max-w-64 truncate px-3 py-2">{r.description}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatShortDate(r.due_date)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{formatBRL(r.amount)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{formatBRL(r.balance)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ReceivableDialog open={creating} onOpenChange={setCreating} onSaved={load} />
      <ReceivableDetail
        receivable={selected}
        customerName={selected ? customerOf(selected) : undefined}
        onOpenChange={(v) => !v && setSelectedId(null)}
        onChanged={load}
      />
    </div>
  );
}
