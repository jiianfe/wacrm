"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  List,
  Loader2,
  Lock,
  MessageSquareText,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import {
  compareTasks,
  formatTaskDate,
  localDateString,
  monthGrid,
  openBlockers,
  TASK_PRIORITIES,
  taskBucket,
  tasksOnDay,
  type TaskBucket,
  type TaskEdge,
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
  notes: { count: number }[];
  files: { count: number }[];
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
  const [edges, setEdges] = useState<TaskEdge[]>([]);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { year: y, month: m - 1 };
  });
  const [selectedDay, setSelectedDay] = useState(today);

  const load = useCallback(async () => {
    const [tasksRes, peopleRes, edgesRes] = await Promise.all([
      supabase
        .from("deal_tasks")
        .select(
          "*, deal:deals(id, title), contact:contacts(id, name), company:companies(id, legal_name, trade_name), notes:task_notes(count), files:task_attachments(count)",
        )
        .order("end_date", { ascending: true })
        .limit(1000),
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
      supabase.from("task_dependencies").select("task_id, depends_on_id").limit(5000),
    ]);
    setEdges((edgesRes.data ?? []) as TaskEdge[]);
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

  const byId = useMemo(() => new Map((tasks ?? []).map((x) => [x.id, x])), [tasks]);

  const listTasks = useMemo(
    () => (view === "calendar" ? tasksOnDay(scoped, selectedDay).sort(compareTasks) : visible),
    [view, scoped, selectedDay, visible],
  );
  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });
  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  async function toggleDone(task: TaskRow) {
    if (!task.completed_at) {
      // A task cannot be finished while something it waits for is still open.
      const waiting = openBlockers(task.id, edges, byId);
      if (waiting.length) return toast.error(t("blockedToast", { names: waiting.map((w) => w.title).join(", ") }));
    }
    const completed_at = task.completed_at ? null : new Date().toISOString();
    const { error } = await supabase.from("deal_tasks").update({ completed_at }).eq("id", task.id);
    if (error) return toast.error(t("toggleFailed"));
    setTasks((prev) => prev?.map((x) => (x.id === task.id ? { ...x, completed_at } : x)) ?? prev);
  }

  async function remove(id: string) {
    // The rows go with the task; the files in storage must be removed by hand.
    const { data: files } = await supabase.from("task_attachments").select("storage_path").eq("task_id", id);
    const { error } = await supabase.from("deal_tasks").delete().eq("id", id);
    if (error) return toast.error(t("deleteFailed"));
    const paths = ((files ?? []) as { storage_path: string }[]).map((f) => f.storage_path);
    if (paths.length) await supabase.storage.from("deal-documents").remove(paths);
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
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label={t("view.label")}>
            {(["list", "calendar"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium",
                  view === v ? "bg-primary/10 text-primary" : "bg-muted text-foreground hover:bg-muted/70",
                )}
              >
                {v === "list" ? <List className="size-4" /> : <CalendarDays className="size-4" />}
                {t(`view.${v}`)}
              </button>
            ))}
          </div>
          {canWrite && (
            <Button type="button" onClick={() => setDialog({ open: true, editing: null })}>
              <Plus className="size-4" />
              {t("new")}
            </Button>
          )}
        </div>
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

      {view === "calendar" && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => shiftMonth(-1)} aria-label={t("calendar.prev")}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-semibold capitalize text-foreground">{monthLabel}</span>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => shiftMonth(1)} aria-label={t("calendar.next")}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-xs">
            {grid[0].map((d) => (
              <div key={d} className="bg-muted px-1 py-1 text-center font-medium text-muted-foreground">
                {new Date(`${d}T12:00:00`).toLocaleDateString(locale, { weekday: "short" })}
              </div>
            ))}
            {grid.flat().map((day) => {
              const inMonth = Number(day.slice(5, 7)) - 1 === cursor.month;
              const items = tasksOnDay(scoped, day).sort(compareTasks);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    "flex min-h-20 flex-col items-stretch gap-0.5 bg-card p-1 text-left align-top hover:bg-muted/50",
                    !inMonth && "opacity-45",
                    selectedDay === day && "ring-2 ring-inset ring-primary",
                  )}
                >
                  <span
                    className={cn(
                      "self-end text-[11px]",
                      day === today ? "rounded-full bg-primary px-1.5 font-semibold text-primary-foreground" : "text-muted-foreground",
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>
                  {items.slice(0, 3).map((x) => (
                    <span
                      key={x.id}
                      className={cn(
                        "truncate rounded px-1 py-0.5 text-[10px] leading-tight",
                        BUCKET_STYLE[taskBucket(x, today)],
                        x.completed_at && "line-through opacity-60",
                      )}
                    >
                      {x.title}
                    </span>
                  ))}
                  {items.length > 3 && (
                    <span className="px-1 text-[10px] text-muted-foreground">{t("calendar.more", { count: items.length - 3 })}</span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs font-medium text-muted-foreground">
            {t("calendar.day", { date: formatTaskDate(selectedDay, locale) })}
          </p>
        </div>
      )}

      <div className={cn("flex flex-wrap gap-1.5", view === "calendar" && "hidden")} role="tablist">
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

      {listTasks.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <ul className="space-y-2">
          {listTasks.map((task) => {
            const bucket = taskBucket(task, today);
            const blockers = openBlockers(task.id, edges, byId);
            const unlocks = edges.filter((e) => e.depends_on_id === task.id).length;
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
                  <button
                    type="button"
                    disabled={!canWrite}
                    onClick={() => setDialog({ open: true, editing: task })}
                    title={t("openDetails")}
                    className={cn(
                      "block max-w-full break-words text-left text-sm font-medium enabled:hover:underline",
                      task.completed_at ? "text-muted-foreground line-through" : "text-foreground",
                    )}
                  >
                    {task.title}
                  </button>
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
                    {blockers.length > 0 && !task.completed_at && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-400">
                        <Lock className="size-3" />
                        {t("blockedBy", { names: blockers.map((b) => b.title).join(", ") })}
                      </span>
                    )}
                    {unlocks > 0 && !task.completed_at && <span>{t("unlocks", { count: unlocks })}</span>}
                    {(task.notes?.[0]?.count ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1" title={t("notes.title")}>
                        <MessageSquareText className="size-3" />
                        {task.notes[0].count}
                      </span>
                    )}
                    {(task.files?.[0]?.count ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1" title={t("files.title")}>
                        <Paperclip className="size-3" />
                        {task.files[0].count}
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
        onChanged={load}
      />
    </div>
  );
}
