"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Building2, Check, GitBranch, Loader2, Pencil, Plus, Search, Trash2, User, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import {
  compareTasks,
  formatTaskDate,
  localDateString,
  TASK_PRIORITIES,
  taskBucket,
  type TaskBucket,
  type TaskPriority,
} from "@/lib/deal-tasks";
import type { DealTask } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TaskDialog } from "@/components/tasks/task-dialog";

type TaskRow = DealTask & {
  deal: { id: string; title: string } | null;
  contact: { id: string; name: string | null } | null;
  company: { id: string; legal_name: string | null; trade_name: string | null } | null;
};

type Tab = "open" | TaskBucket;
const TABS: Tab[] = ["open", "overdue", "today", "later", "done"];

const FIELD =
  "rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  high: "bg-red-500/15 text-red-400",
  normal: "bg-muted text-muted-foreground",
  low: "bg-sky-500/15 text-sky-400",
};
const BUCKET_STYLE: Record<TaskBucket, string> = {
  overdue: "bg-red-500/15 text-red-400",
  today: "bg-amber-500/15 text-amber-400",
  later: "bg-muted text-muted-foreground",
  done: "bg-muted text-muted-foreground",
};

export default function TasksPage() {
  const t = useTranslations("Tasks");
  const locale = useLocale();
  const { profile } = useAuth();
  const canWrite = useCan("send-messages");
  const supabase = useMemo(() => createClient(), []);
  const today = localDateString();

  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [people, setPeople] = useState<{ id: string; label: string }[]>([]);
  const [tab, setTab] = useState<Tab>("open");
  const [who, setWho] = useState<string>("me"); // me | all | none | <profile id>
  const [priority, setPriority] = useState<"" | TaskPriority>("");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; editing: TaskRow | null }>({ open: false, editing: null });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [tasksRes, peopleRes] = await Promise.all([
      supabase
        .from("deal_tasks")
        .select(
          "*, deal:deals(id, title), contact:contacts(id, name), company:companies(id, legal_name, trade_name)",
        )
        .order("end_date", { ascending: true })
        .limit(1000),
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
    ]);
    if (tasksRes.error) toast.error(t("loadFailed"));
    setTasks((tasksRes.data ?? []) as unknown as TaskRow[]);
    setPeople(
      ((peopleRes.data ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => ({
        id: p.id,
        label: p.full_name || p.email,
      })),
    );
  }, [supabase, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.label])), [people]);

  // Everything except the tab, so the tab counters stay meaningful.
  const scoped = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (tasks ?? []).filter((x) => {
      if (who === "me" && x.assigned_to !== profile?.id) return false;
      if (who === "none" && x.assigned_to) return false;
      if (who !== "me" && who !== "all" && who !== "none" && x.assigned_to !== who) return false;
      if (priority && x.priority !== priority) return false;
      if (!term) return true;
      return [x.title, x.description, x.deal?.title, x.contact?.name, x.company?.trade_name, x.company?.legal_name]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(term));
    });
  }, [tasks, who, priority, search, profile?.id]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { open: 0, overdue: 0, today: 0, later: 0, done: 0 };
    for (const x of scoped) {
      const b = taskBucket(x, today);
      c[b] += 1;
      if (b !== "done") c.open += 1;
    }
    return c;
  }, [scoped, today]);

  const visible = useMemo(
    () =>
      scoped
        .filter((x) => {
          const b = taskBucket(x, today);
          return tab === "open" ? b !== "done" : b === tab;
        })
        .sort(compareTasks),
    [scoped, tab, today],
  );

  async function toggleDone(task: TaskRow) {
    const completed_at = task.completed_at ? null : new Date().toISOString();
    const { error } = await supabase.from("deal_tasks").update({ completed_at }).eq("id", task.id);
    if (error) return toast.error(t("toggleFailed"));
    setTasks((prev) => prev?.map((x) => (x.id === task.id ? { ...x, completed_at } : x)) ?? prev);
  }

  async function remove(id: string) {
    const { error } = await supabase.from("deal_tasks").delete().eq("id", id);
    if (error) return toast.error(t("deleteFailed"));
    setTasks((prev) => prev?.filter((x) => x.id !== id) ?? prev);
    setConfirmingId(null);
  }

  if (tasks === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canWrite && (
          <Button type="button" onClick={() => setDialog({ open: true, editing: null })}>
            <Plus className="size-4" />
            {t("new")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input
            className={cn(FIELD, "w-full pl-8")}
            placeholder={t("search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className={FIELD} value={who} onChange={(e) => setWho(e.target.value)} aria-label={t("assignee")}>
          <option value="me">{t("mine")}</option>
          <option value="all">{t("everyone")}</option>
          <option value="none">{t("unassigned")}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          className={FIELD}
          value={priority}
          onChange={(e) => setPriority(e.target.value as "" | TaskPriority)}
          aria-label={t("form.priority")}
        >
          <option value="">{t("allPriorities")}</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`priority.${p}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
              tab === k
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted text-foreground hover:bg-muted/70",
            )}
          >
            {t(`tab.${k}`)} <span className="text-xs opacity-70">{counts[k]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((task) => {
            const bucket = taskBucket(task, today);
            const person = task.assigned_to ? nameOf.get(task.assigned_to) : null;
            const company = task.company?.trade_name || task.company?.legal_name;
            return (
              <li
                key={task.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
              >
                <button
                  type="button"
                  disabled={!canWrite}
                  onClick={() => toggleDone(task)}
                  aria-label={task.completed_at ? t("markOpen") : t("markDone")}
                  title={task.completed_at ? t("markOpen") : t("markDone")}
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border disabled:cursor-not-allowed disabled:opacity-50",
                    task.completed_at
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-muted hover:border-primary",
                  )}
                >
                  {task.completed_at && <Check className="size-3.5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "break-words text-sm font-medium",
                      task.completed_at ? "text-muted-foreground line-through" : "text-foreground",
                    )}
                  >
                    {task.title}
                  </p>
                  {task.description && (
                    <p className="break-words text-xs text-muted-foreground">{task.description}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span className={cn("rounded-full px-2 py-0.5 font-medium", BUCKET_STYLE[bucket])}>
                      {t(`bucket.${bucket}`, { date: formatTaskDate(task.end_date, locale) })}
                    </span>
                    {task.priority !== "normal" && (
                      <span className={cn("rounded-full px-2 py-0.5 font-medium", PRIORITY_STYLE[task.priority])}>
                        {t(`priority.${task.priority}`)}
                      </span>
                    )}
                    <span>
                      {formatTaskDate(task.start_date, locale)} → {formatTaskDate(task.end_date, locale)}
                    </span>
                    {person && (
                      <span className="inline-flex items-center gap-1">
                        <User className="size-3" />
                        {person}
                      </span>
                    )}
                    {task.deal && (
                      <span className="inline-flex items-center gap-1">
                        <GitBranch className="size-3" />
                        {task.deal.title}
                      </span>
                    )}
                    {task.contact?.name && <span>{task.contact.name}</span>}
                    {company && (
                      <span className="inline-flex items-center gap-1">
                        <Building2 className="size-3" />
                        {company}
                      </span>
                    )}
                  </div>
                </div>
                {canWrite && (
                  <div className="flex shrink-0 items-center gap-1">
                    {confirmingId === task.id ? (
                      <span className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => remove(task.id)}
                          className="font-medium text-red-400 hover:underline"
                        >
                          {t("confirmDelete")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          aria-label={t("cancel")}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="size-3.5" />
                        </button>
                      </span>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDialog({ open: true, editing: task })}
                          aria-label={t("edit")}
                          title={t("edit")}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setConfirmingId(task.id)}
                          aria-label={t("delete")}
                          title={t("delete")}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <TaskDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))}
        editing={dialog.editing}
        onSaved={load}
      />
    </div>
  );
}
