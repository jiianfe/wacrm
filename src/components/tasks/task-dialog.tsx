"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  localDateString,
  TASK_PRIORITIES,
  wouldCycle,
  type TaskEdge,
  type TaskPriority,
} from "@/lib/deal-tasks";
import type { DealTask } from "@/types";
import { Button } from "@/components/ui/button";
import { TaskAttachments } from "./task-attachments";
import { TaskChecklist } from "./task-checklist";
import { TaskNotes } from "./task-notes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface TaskPrefill {
  contact_id?: string | null;
  company_id?: string | null;
  deal_id?: string | null;
  title?: string;
}

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  /** Called when notes or files change, so counters elsewhere can refresh. */
  onChanged?: () => void;
  /** When given, edits this task instead of creating one. */
  editing?: DealTask | null;
  prefill?: TaskPrefill;
}

interface DealOption {
  id: string;
  title: string;
  contact_id: string | null;
  company_id: string | null;
}

interface Candidate {
  id: string;
  title: string;
  end_date: string;
  completed_at: string | null;
}

interface Option {
  id: string;
  label: string;
}

const FIELD =
  "w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Create or edit a task (stand-alone, or attached to a deal / customer). */
export function TaskDialog({ open, onOpenChange, onSaved, onChanged, editing, prefill }: TaskDialogProps) {
  const t = useTranslations("Tasks");
  const { user, accountId, profile } = useAuth();

  const [people, setPeople] = useState<Option[]>([]);
  const [contacts, setContacts] = useState<Option[]>([]);
  const [companies, setCompanies] = useState<Option[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [assignedTo, setAssignedTo] = useState("");
  const [contactId, setContactId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [dealId, setDealId] = useState("");
  // Tasks this one waits for: all open tasks to pick from, the current choice,
  // and what is already saved (to know what to add or remove on save).
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [deps, setDeps] = useState<string[]>([]);
  const [savedDeps, setSavedDeps] = useState<string[]>([]);
  const [edges, setEdges] = useState<TaskEdge[]>([]);

  const profileId = profile?.id;
  useEffect(() => {
    if (!open) return;
    const today = localDateString();
    /* eslint-disable react-hooks/set-state-in-effect */
    setTitle(editing?.title ?? prefill?.title ?? "");
    setDescription(editing?.description ?? "");
    setStart(editing?.start_date ?? today);
    setEnd(editing?.end_date ?? today);
    setPriority(editing?.priority ?? "normal");
    setAssignedTo(editing ? (editing.assigned_to ?? "") : (profileId ?? ""));
    setContactId(editing?.contact_id ?? prefill?.contact_id ?? "");
    setCompanyId(editing?.company_id ?? prefill?.company_id ?? "");
    setDealId(editing?.deal_id ?? prefill?.deal_id ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, editing, prefill, profileId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const [p, c, co, tk, ed] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email").order("full_name"),
        supabase.from("contacts").select("id, name, phone, email").order("name").limit(1000),
        supabase.from("companies").select("id, legal_name, trade_name").order("legal_name").limit(1000),
        supabase
          .from("deal_tasks")
          .select("id, title, end_date, completed_at")
          .order("end_date", { ascending: false })
          .limit(500),
        supabase.from("task_dependencies").select("task_id, depends_on_id").limit(5000),
      ]);
      if (cancelled) return;
      setCandidates(
        ((tk.data ?? []) as Candidate[]).filter((x) => x.id !== editing?.id),
      );
      const all = (ed.data ?? []) as TaskEdge[];
      setEdges(all);
      const mine = editing ? all.filter((e) => e.task_id === editing.id).map((e) => e.depends_on_id) : [];
      setDeps(mine);
      setSavedDeps(mine);
      setPeople(
        ((p.data ?? []) as { id: string; full_name: string | null; email: string }[]).map((x) => ({
          id: x.id,
          label: x.full_name || x.email,
        })),
      );
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
    // editing is read once per opening; the dialog reloads when it reopens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  // Deals to link the task to.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    createClient()
      .from("deals")
      .select("id, title, contact_id, company_id")
      .order("created_at", { ascending: false })
      .limit(1000)
      .then(({ data }) => {
        if (!cancelled) setDeals((data ?? []) as DealOption[]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // With a customer chosen, offer that customer's deals (plus the one already picked).
  const dealOptions = deals.filter((d) => !contactId || d.contact_id === contactId || d.id === dealId);

  function pickDeal(id: string) {
    setDealId(id);
    const deal = deals.find((d) => d.id === id);
    if (!deal) return;
    // Fill the customer from the deal when still empty.
    if (!contactId && deal.contact_id) setContactId(deal.contact_id);
    if (!companyId && deal.company_id) setCompanyId(deal.company_id);
  }

  // Prerequisites that would close a loop (a task that already waits for this one).
  const pickable = candidates.filter(
    (c) => !c.completed_at && !deps.includes(c.id) && !(editing && wouldCycle(editing.id, c.id, edges)),
  );

  async function save() {
    if (!title.trim()) return toast.error(t("form.titleRequired"));
    if (!start || !end || end < start) return toast.error(t("form.datesInvalid"));
    if (!accountId) return;

    setSaving(true);
    try {
      const supabase = createClient();
      const fields = {
        title: title.trim(),
        description: description.trim() || null,
        start_date: start,
        end_date: end,
        priority,
        assigned_to: assignedTo || null,
        contact_id: contactId || null,
        company_id: companyId || null,
        deal_id: dealId || null,
      };
      let taskId: string;
      if (editing) {
        // Changing the date makes a fresh reminder possible again.
        const { error } = await supabase
          .from("deal_tasks")
          .update({ ...fields, ...(end !== editing.end_date ? { reminded_on: null } : {}) })
          .eq("id", editing.id);
        if (error) throw error;
        taskId = editing.id;
      } else {
        const { data, error } = await supabase
          .from("deal_tasks")
          .insert({
            ...fields,
            account_id: accountId,
            user_id: user?.id ?? null,
          })
          .select("id")
          .single();
        if (error || !data) throw error ?? new Error("no row");
        taskId = (data as { id: string }).id;
      }

      const removed = savedDeps.filter((id) => !deps.includes(id));
      const added = deps.filter((id) => !savedDeps.includes(id));
      if (removed.length) {
        const { error } = await supabase
          .from("task_dependencies")
          .delete()
          .eq("task_id", taskId)
          .in("depends_on_id", removed);
        if (error) throw error;
      }
      if (added.length) {
        const { error } = await supabase
          .from("task_dependencies")
          .insert(added.map((depends_on_id) => ({ task_id: taskId, depends_on_id, account_id: accountId })));
        if (error) throw error;
      }
      toast.success(t("form.saved"));
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(t("form.saveFailed"));
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
          <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
            {t("form.name")}
            <input className={FIELD} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
            {t("form.details")}
            <textarea
              className={FIELD}
              rows={2}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("form.start")}
            <input
              className={FIELD}
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (end < e.target.value) setEnd(e.target.value);
              }}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("form.end")}
            <input className={FIELD} type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("form.priority")}
            <select className={FIELD} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority.${p}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("form.assignee")}
            <select className={FIELD} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">{t("form.noAssignee")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("form.contact")}
            <select className={FIELD} value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">{t("form.noContact")}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("form.company")}
            <select className={FIELD} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">{t("form.noCompany")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
            {t("form.deal")}
            <select className={FIELD} value={dealId} onChange={(e) => pickDeal(e.target.value)}>
              <option value="">{t("form.noDeal")}</option>
              {dealId && !deals.some((d) => d.id === dealId) && <option value={dealId}>{dealId.slice(0, 8)}…</option>}
              {dealOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-1.5 text-xs text-muted-foreground sm:col-span-2">
            {t("form.dependsOn")}
            {deps.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {deps.map((id) => {
                  const c = candidates.find((x) => x.id === id);
                  return (
                    <li
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-foreground"
                    >
                      <span className="max-w-56 truncate">{c?.title ?? id.slice(0, 8)}</span>
                      <button
                        type="button"
                        aria-label={t("form.removeDependency")}
                        onClick={() => setDeps((d) => d.filter((x) => x !== id))}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <select
              className={FIELD}
              value=""
              onChange={(e) => e.target.value && setDeps((d) => [...d, e.target.value])}
              disabled={pickable.length === 0}
            >
              <option value="">{pickable.length ? t("form.addDependency") : t("form.noDependencyOptions")}</option>
              {pickable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <span>{t("form.dependsHint")}</span>
          </div>
        </div>

        {editing ? (
          <div className="grid gap-4 border-t border-border pt-3">
            <TaskChecklist taskId={editing.id} onChanged={onChanged} />
            <TaskNotes taskId={editing.id} onChanged={onChanged} />
            <TaskAttachments taskId={editing.id} onChanged={onChanged} />
          </div>
        ) : (
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">{t("saveFirst")}</p>
        )}

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
