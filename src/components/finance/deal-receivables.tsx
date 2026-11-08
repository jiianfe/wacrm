"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useCan } from "@/hooks/use-can";
import { formatBRL, formatShortDate } from "@/lib/quotes/format";
import type { ReceivableRow } from "@/lib/finance/finance";
import { ReceivableDetail } from "./receivable-detail";
import { ReceivableDialog, type ReceivablePrefill } from "./receivable-dialog";
import { StatusBadge } from "./status-badge";

interface DealReceivablesProps {
  dealId: string;
  contactId?: string | null;
  companyId?: string | null;
}

/** The receivables hanging on a deal, with a shortcut to add one. */
export function DealReceivables({ dealId, contactId, companyId }: DealReceivablesProps) {
  const t = useTranslations("Finance");
  const canWork = useCan("send-messages");
  const [rows, setRows] = useState<ReceivableRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from("receivable_balances")
      .select("*")
      .eq("deal_id", dealId)
      .order("due_date", { ascending: true });
    setRows(
      ((data ?? []) as ReceivableRow[]).map((r) => ({
        ...r,
        amount: Number(r.amount),
        paid_amount: Number(r.paid_amount),
        balance: Number(r.balance),
      })),
    );
  }, [dealId]);

  useEffect(() => {
    if (!canWork) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [canWork, load]);

  const prefill = useMemo<ReceivablePrefill>(
    () => ({ deal_id: dealId, contact_id: contactId ?? null, company_id: companyId ?? null }),
    [dealId, contactId, companyId],
  );

  if (!canWork) return null;
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{t("deal.title")}</span>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
        >
          <Plus className="size-3.5" />
          {t("deal.add")}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("deal.none")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelectedId(r.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1 truncate">{r.description}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatShortDate(r.due_date)}</span>
                <span className="shrink-0 font-medium">{formatBRL(r.status === "paid" ? r.amount : r.balance)}</span>
                <StatusBadge status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ReceivableDialog open={creating} onOpenChange={setCreating} onSaved={load} prefill={prefill} />
      <ReceivableDetail
        receivable={selected}
        onOpenChange={(v) => !v && setSelectedId(null)}
        onChanged={load}
      />
    </div>
  );
}
