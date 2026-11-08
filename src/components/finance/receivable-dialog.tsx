"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { parseMoney } from "@/lib/quotes/format";
import {
  PAYMENT_METHODS,
  buildInstallments,
  todayFortaleza,
  type PaymentMethod,
  type ReceivableRow,
} from "@/lib/finance/finance";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ReceivablePrefill {
  contact_id?: string | null;
  company_id?: string | null;
  deal_id?: string | null;
  quote_id?: string | null;
  description?: string;
  amount?: number;
  method?: PaymentMethod | null;
}

interface ReceivableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after saving, so the caller can reload. */
  onSaved: () => void;
  /** Starting values for a new receivable (e.g. from a quote). */
  prefill?: ReceivablePrefill;
  /** When given, edits this receivable instead of creating one. */
  editing?: ReceivableRow | null;
}

interface Option {
  id: string;
  label: string;
}

const FIELD =
  "w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Create (one or several instalments) or edit a receivable. */
export function ReceivableDialog({ open, onOpenChange, onSaved, prefill, editing }: ReceivableDialogProps) {
  const t = useTranslations("Finance");
  const { user, accountId } = useAuth();

  const [contacts, setContacts] = useState<Option[]>([]);
  const [companies, setCompanies] = useState<Option[]>([]);
  const [deals, setDeals] = useState<Option[]>([]);

  const [contactId, setContactId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [dealId, setDealId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [method, setMethod] = useState<string>("");
  const [reference, setReference] = useState("");
  const [installments, setInstallments] = useState("1");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Start from the receivable being edited, the prefill, or a blank form.
  useEffect(() => {
    if (!open) return;
     
    setContactId(editing?.contact_id ?? prefill?.contact_id ?? "");
    setCompanyId(editing?.company_id ?? prefill?.company_id ?? "");
    setDealId(editing?.deal_id ?? prefill?.deal_id ?? "");
    setDescription(editing?.description ?? prefill?.description ?? "");
    setAmount(
      editing ? String(editing.amount).replace(".", ",") : prefill?.amount ? String(prefill.amount).replace(".", ",") : "",
    );
    setDueDate(editing?.due_date ?? todayFortaleza());
    setMethod(editing?.method ?? prefill?.method ?? "");
    setReference(editing?.reference ?? "");
    setInstallments("1");
    setNote(editing?.note ?? "");
     
  }, [open, editing, prefill]);

  // Customers to pick from.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const [c, co] = await Promise.all([
        supabase.from("contacts").select("id, name, phone, email").order("name").limit(1000),
        supabase.from("companies").select("id, legal_name, trade_name").order("legal_name").limit(1000),
      ]);
      if (cancelled) return;
      setContacts(
        ((c.data ?? []) as { id: string; name: string | null; phone: string | null; email: string | null }[]).map((x) => ({
          id: x.id,
          label: x.name || x.email || x.phone || x.id,
        })),
      );
      setCompanies(
        ((co.data ?? []) as { id: string; legal_name: string | null; trade_name: string | null }[]).map((x) => ({
          id: x.id,
          label: x.trade_name || x.legal_name || x.id,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Deals of the chosen contact, so a receivable can hang on a deal.
  useEffect(() => {
    if (!open || !contactId) {
       
      setDeals([]);
      return;
    }
    let cancelled = false;
    createClient()
      .from("deals")
      .select("id, title")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!cancelled) {
          setDeals(((data ?? []) as { id: string; title: string }[]).map((d) => ({ id: d.id, label: d.title })));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, contactId]);

  async function save() {
    const value = parseMoney(amount);
    if (!description.trim()) return toast.error(t("form.needDescription"));
    if (!Number.isFinite(value) || value <= 0) return toast.error(t("form.needAmount"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return toast.error(t("form.needDue"));
    if (!contactId && !companyId) return toast.error(t("form.needCustomer"));
    const count = editing ? 1 : Math.min(24, Math.max(1, Math.floor(Number(installments) || 1)));

    setSaving(true);
    try {
      const supabase = createClient();
      const common = {
        contact_id: contactId || null,
        company_id: companyId || null,
        deal_id: dealId || null,
        quote_id: editing ? editing.quote_id : (prefill?.quote_id ?? null),
        method: method || null,
        reference: reference.trim() || null,
        note: note.trim() || null,
      };
      if (editing) {
        const { error } = await supabase
          .from("receivables")
          .update({ ...common, description: description.trim(), amount: value, due_date: dueDate })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const drafts = buildInstallments({ amount: value, count, firstDue: dueDate, description: description.trim() });
        if (!accountId) throw new Error("no account");
        const { error } = await supabase.from("receivables").insert(
          drafts.map((d) => ({ ...common, ...d, account_id: accountId, user_id: user?.id ?? null })),
        );
        if (error) throw error;
      }
      toast.success(t("form.saved"));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const message = (err as { message?: string })?.message ?? "";
      toast.error(/below what was already received/i.test(message) ? t("form.amountBelowPaid") : t("form.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto bg-popover border-border text-popover-foreground sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {editing ? t("form.titleEdit") : t("form.titleNew")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("form.titleNew")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("form.contact")}
            <select className={FIELD} value={contactId} onChange={(e) => { setContactId(e.target.value); setDealId(""); }}>
              <option value="">{t("form.noContact")}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("form.company")}
            <select className={FIELD} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">{t("form.noCompany")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
            {t("form.deal")}
            <select className={FIELD} value={dealId} onChange={(e) => setDealId(e.target.value)} disabled={!contactId && !dealId}>
              <option value="">{t("form.noDeal")}</option>
              {dealId && !deals.some((d) => d.id === dealId) && <option value={dealId}>{dealId.slice(0, 8)}…</option>}
              {deals.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
            {t("form.description")}
            <input className={FIELD} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("form.amount")}
            <input className={FIELD} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("form.dueDate")}
            <input className={FIELD} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("form.expected")}
            <select className={FIELD} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">—</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{t(`method.${m}`)}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("form.reference")}
            <input className={FIELD} value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} />
          </label>
          {!editing && (
            <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
              {t("form.installments")}
              <input
                className={FIELD}
                type="number"
                min={1}
                max={24}
                value={installments}
                onChange={(e) => setInstallments(e.target.value)}
              />
              <span>{t("form.installmentsHint")}</span>
            </label>
          )}
          <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
            {t("form.note")}
            <textarea className={FIELD} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("form.cancel")}
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t("form.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
