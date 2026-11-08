"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Banknote, Loader2, Pencil, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { formatBRL, formatShortDate } from "@/lib/quotes/format";
import { todayFortaleza, type PaymentRow, type ReceivableRow } from "@/lib/finance/finance";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaymentDialog } from "./payment-dialog";
import { ReceivableDialog } from "./receivable-dialog";
import { StatusBadge } from "./status-badge";

interface ReceivableDetailProps {
  receivable: ReceivableRow | null;
  customerName?: string;
  onOpenChange: (open: boolean) => void;
  /** Called after any change, so the list behind it reloads. */
  onChanged: () => void;
}

/** One receivable: its figures, its payments, and the actions on it. */
export function ReceivableDetail({ receivable, customerName, onOpenChange, onChanged }: ReceivableDetailProps) {
  const t = useTranslations("Finance");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState<ReceivableRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const id = receivable?.id;
  const loadPayments = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data } = await createClient()
      .from("receivable_payments")
      .select("*")
      .eq("receivable_id", id)
      .order("paid_at", { ascending: false })
      .order("created_at", { ascending: false });
    setPayments(((data ?? []) as PaymentRow[]).map((p) => ({ ...p, amount: Number(p.amount) })));
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirmCancel(false);
    setConfirmDeleteId(null);
    loadPayments();
  }, [loadPayments]);

  const changed = () => {
    loadPayments();
    onChanged();
  };

  async function setCancelled(cancelled: boolean) {
    if (!receivable) return;
    const { error } = await createClient()
      .from("receivables")
      .update({ cancelled_at: cancelled ? new Date().toISOString() : null })
      .eq("id", receivable.id);
    if (error) {
      toast.error(t("detail.failed"));
      return;
    }
    setConfirmCancel(false);
    changed();
  }

  async function deletePayment(paymentId: string) {
    const { error } = await createClient().from("receivable_payments").delete().eq("id", paymentId);
    if (error) {
      toast.error(t("detail.failed"));
      return;
    }
    setConfirmDeleteId(null);
    changed();
  }

  async function markDeposited(payment: PaymentRow) {
    const { error } = await createClient()
      .from("receivable_payments")
      .update({ deposited_at: payment.deposited_at ? null : todayFortaleza() })
      .eq("id", payment.id);
    if (error) {
      toast.error(t("detail.failed"));
      return;
    }
    changed();
  }

  const r = receivable;
  const canReceive = !!r && r.status !== "paid" && r.status !== "cancelled";

  return (
    <>
      <Dialog open={!!r} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto bg-popover border-border text-popover-foreground sm:max-w-xl">
          {r && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-6 text-popover-foreground">
                  <span className="break-words">{r.description}</span>
                  <StatusBadge status={r.status} />
                </DialogTitle>
                <DialogDescription>
                  {customerName ? `${customerName} · ` : ""}
                  {t("table.due")} {formatShortDate(r.due_date)}
                  {r.installment_no && r.installment_total
                    ? ` · ${t("detail.installment", { no: r.installment_no, total: r.installment_total })}`
                    : ""}
                </DialogDescription>
              </DialogHeader>

              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-md bg-muted p-2">
                  <dt className="text-xs text-muted-foreground">{t("table.amount")}</dt>
                  <dd className="font-semibold">{formatBRL(Number(r.amount))}</dd>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <dt className="text-xs text-muted-foreground">{t("table.paid")}</dt>
                  <dd className="font-semibold">{formatBRL(Number(r.paid_amount))}</dd>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <dt className="text-xs text-muted-foreground">{t("table.balance")}</dt>
                  <dd className="font-semibold">{formatBRL(Number(r.balance))}</dd>
                </div>
              </dl>

              {(r.method || r.reference || r.note) && (
                <p className="text-xs text-muted-foreground">
                  {[r.method ? t(`method.${r.method}`) : null, r.reference, r.note].filter(Boolean).join(" · ")}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {canReceive && (
                  <Button type="button" size="sm" onClick={() => setPaying(r)}>
                    <Banknote className="size-4" />
                    {t("detail.register")}
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" />
                  {t("detail.edit")}
                </Button>
                {r.status === "cancelled" ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setCancelled(false)}>
                    {t("detail.reactivate")}
                  </Button>
                ) : confirmCancel ? (
                  <>
                    <Button type="button" size="sm" variant="destructive" onClick={() => setCancelled(true)}>
                      {t("detail.confirmCancel")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                      {t("form.cancel")}
                    </Button>
                  </>
                ) : (
                  r.status !== "paid" && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>
                      {t("detail.cancelReceivable")}
                    </Button>
                  )
                )}
              </div>

              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("detail.payments")}
                </h3>
                {loading ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("detail.noPayments")}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {payments.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                        <span className="font-medium">{formatBRL(p.amount)}</span>
                        <span className="text-muted-foreground">
                          {t(`method.${p.method}`)} · {formatShortDate(p.paid_at)}
                        </span>
                        {p.note && <span className="min-w-0 truncate text-xs text-muted-foreground">{p.note}</span>}
                        <span className="ml-auto flex items-center gap-2">
                          {p.method === "cash" && (
                            <button
                              type="button"
                              onClick={() => markDeposited(p)}
                              className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted"
                            >
                              {p.deposited_at
                                ? t("detail.deposited", { date: formatShortDate(p.deposited_at) })
                                : t("detail.markDeposited")}
                            </button>
                          )}
                          {confirmDeleteId === p.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => deletePayment(p.id)}
                                className="rounded-md bg-red-600 px-2 py-0.5 text-xs text-white"
                              >
                                {t("detail.confirmDeletePayment")}
                              </button>
                              <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-xs text-muted-foreground">
                                {t("form.cancel")}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              aria-label={t("detail.deletePayment")}
                              title={t("detail.deletePayment")}
                              onClick={() => setConfirmDeleteId(p.id)}
                              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <PaymentDialog receivable={paying} onOpenChange={(v) => !v && setPaying(null)} onSaved={changed} />
      <ReceivableDialog open={editing} onOpenChange={setEditing} editing={r} onSaved={changed} />
    </>
  );
}
