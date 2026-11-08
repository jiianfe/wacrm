"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatBRL, parseMoney } from "@/lib/quotes/format";
import { PAYMENT_METHODS, toCents, todayFortaleza, type PaymentMethod, type ReceivableRow } from "@/lib/finance/finance";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PaymentDialogProps {
  receivable: ReceivableRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const FIELD =
  "w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Registers money received on a receivable (full or partial). */
export function PaymentDialog({ receivable, onOpenChange, onSaved }: PaymentDialogProps) {
  const t = useTranslations("Finance");
  const { user } = useAuth();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [paidAt, setPaidAt] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const receivableId = receivable?.id;
  const balance = receivable ? Number(receivable.balance) : 0;
  useEffect(() => {
    if (!receivableId) return;
     
    setAmount(String(balance).replace(".", ","));
    setMethod("pix");
    setPaidAt(todayFortaleza());
    setNote("");
     
  }, [receivableId, balance]);

  async function save() {
    if (!receivable) return;
    const value = parseMoney(amount);
    if (!Number.isFinite(value) || value <= 0) return toast.error(t("pay.needAmount"));
    if (toCents(value) > toCents(balance)) return toast.error(t("pay.exceeds", { balance: formatBRL(balance) }));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) return toast.error(t("pay.needDate"));

    setSaving(true);
    try {
      const { error } = await createClient()
        .from("receivable_payments")
        .insert({
          account_id: receivable.account_id,
          receivable_id: receivable.id,
          user_id: user?.id ?? null,
          amount: value,
          method,
          paid_at: paidAt,
          note: note.trim() || null,
        });
      if (error) throw error;
      toast.success(t("pay.saved"));
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(t("pay.failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!receivable} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("pay.title")}</DialogTitle>
          <DialogDescription>
            {receivable?.description} · {t("pay.balance", { balance: formatBRL(balance) })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("pay.amount")}
            <input className={FIELD} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>

          <div className="grid gap-1 text-xs text-muted-foreground">
            {t("pay.method")}
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={t("pay.method")}>
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => setMethod(m)}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-sm font-medium transition-colors",
                    method === m
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted text-foreground hover:bg-muted/70",
                  )}
                >
                  {t(`method.${m}`)}
                </button>
              ))}
            </div>
            {method === "cash" && <span>{t("pay.cashHint")}</span>}
          </div>

          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("pay.date")}
            <input className={FIELD} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("pay.note")}
            <input className={FIELD} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("form.cancel")}
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t("pay.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
