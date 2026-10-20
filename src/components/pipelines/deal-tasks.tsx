"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import {
  formatTaskDate,
  localDateString,
  taskState,
  type TaskState,
} from "@/lib/deal-tasks";
import type { DealTask, Profile } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STATE_STYLE: Record<TaskState, string> = {
  overdue: "bg-red-500/15 text-red-400",
  active: "bg-emerald-500/15 text-emerald-400",
  upcoming: "bg-muted text-muted-foreground",
  done: "bg-muted text-muted-foreground",
};

interface Draft {
  title: string;
  description: string;
  start: string;
  end: string;
  assignedTo: string;
}

/**
 * Tasks of a deal, each with a start and an end date. The board card turns
 * green while an open task is within its period and red once an open
 * task's end date has passed (see `src/lib/deal-tasks.ts`).
 */
export function DealTasks({
  dealId,
  onChanged,
}: {
  dealId: string;
  /** Called after any change so the board card can recolour itself. */
  onChanged?: () => void;
}) {
  const t = useTranslations("Pipelines.tasks");
  const locale = useLocale();
  const supabase = createClient();
  const { accountId, profile } = useAuth();
  const canWrite = useCan("send-messages");

  const today = localDateString();
  const emptyDraft = useCallback(
    (): Draft => ({
      title: "",
      description: "",
      start: today,
      end: today,
      assignedTo: profile?.id ?? "",
    }),
    [today, profile?.id],
  );

  const [tasks, setTasks] = useState<DealTask[]>([]);
  const [people, setPeople] = useState<Pick<Profile, "id" | "full_name" | "email">[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [tasksRes, peopleRes] = await Promise.all([
      supabase.from("deal_tasks").select("*").eq("deal_id", dealId),
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
    ]);
    if (tasksRes.error) toast.error(t("loadFailed"));
    setTasks((tasksRes.data ?? []) as DealTask[]);
    setPeople((peopleRes.data ?? []) as Pick<Profile, "id" | "full_name" | "email">[]);
    setLoading(false);
  }, [supabase, dealId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const nameOf = useMemo(() => {
    const map = new Map(people.map((p) => [p.id, p.full_name || p.email]));
    return (id: string | null) => (id ? map.get(id) ?? null : null);
  }, [people]);

  // Open tasks first (soonest end date first), finished ones at the bottom.
  const sorted = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (!!a.completed_at !== !!b.completed_at) return a.completed_at ? 1 : -1;
        return a.end_date.localeCompare(b.end_date);
      }),
    [tasks],
  );

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      // Keep the period valid while typing.
      if (key === "start" && next.end < next.start) next.end = next.start;
      return next;
    });
  }

  function startEdit(task: DealTask) {
    setEditingId(task.id);
    setDraft({
      title: task.title,
      description: task.description ?? "",
      start: task.start_date,
      end: task.end_date,
      assignedTo: task.assigned_to ?? "",
    });
  }

  function resetForm() {
    setEditingId(null);
    setDraft(emptyDraft());
  }

  async function handleSave() {
    const title = draft.title.trim();
    if (!title) {
      toast.error(t("titleRequired"));
      return;
    }
    if (!draft.start || !draft.end || draft.end < draft.start) {
      toast.error(t("datesInvalid"));
      return;
    }
    if (!accountId) return;

    setSaving(true);
    const fields = {
      title,
      description: draft.description.trim() || null,
      start_date: draft.start,
      end_date: draft.end,
      assigned_to: draft.assignedTo || null,
    };

    if (editingId) {
      const { data, error } = await supabase
        .from("deal_tasks")
        .update(fields)
        .eq("id", editingId)
        .select("*")
        .single();
      setSaving(false);
      if (error || !data) {
        toast.error(t("saveFailed"));
        return;
      }
      setTasks((prev) => prev.map((x) => (x.id === editingId ? (data as DealTask) : x)));
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const { data, error } = await supabase
        .from("deal_tasks")
        .insert({
          ...fields,
          deal_id: dealId,
          account_id: accountId,
          user_id: session?.user?.id ?? null,
        })
        .select("*")
        .single();
      setSaving(false);
      if (error || !data) {
        toast.error(t("saveFailed"));
        return;
      }
      setTasks((prev) => [...prev, data as DealTask]);
    }
    resetForm();
    onChanged?.();
  }

  async function toggleDone(task: DealTask) {
    const completed_at = task.completed_at ? null : new Date().toISOString();
    const { data, error } = await supabase
      .from("deal_tasks")
      .update({ completed_at })
      .eq("id", task.id)
      .select("*")
      .single();
    if (error || !data) {
      toast.error(t("toggleFailed"));
      return;
    }
    setTasks((prev) => prev.map((x) => (x.id === task.id ? (data as DealTask) : x)));
    onChanged?.();
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from("deal_tasks").delete().eq("id", id);
    if (error) {
      toast.error(t("deleteFailed"));
      return;
    }
    setTasks((prev) => prev.filter((x) => x.id !== id));
    setConfirmingId(null);
    if (editingId === id) resetForm();
    onChanged?.();
  }

  const stateLabel = (task: DealTask, state: TaskState) => {
    switch (state) {
      case "overdue":
        return t("stateOverdue");
      case "active":
        return t("stateActive");
      case "upcoming":
        return t("stateUpcoming", { date: formatTaskDate(task.start_date, locale) });
      case "done":
        return t("stateDone", {
          date: new Date(task.completed_at as string).toLocaleDateString(locale, {
            day: "2-digit",
            month: "short",
          }),
        });
    }
  };

  return (
    <div className="grid gap-2">
      <Label className="text-muted-foreground">{t("title")}</Label>

      {canWrite && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-foreground">
            {editingId ? t("editHeading") : t("addHeading")}
          </p>
          <Input
            value={draft.title}
            onChange={(e) => setField("title", e.target.value.slice(0, 200))}
            placeholder={t("titlePlaceholder")}
            className="border-border bg-muted text-foreground"
          />
          <Input
            value={draft.description}
            onChange={(e) => setField("description", e.target.value.slice(0, 2000))}
            placeholder={t("detailsPlaceholder")}
            className="border-border bg-muted text-foreground"
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="task-start" className="text-xs text-muted-foreground">
                {t("start")}
              </Label>
              <Input
                id="task-start"
                type="date"
                value={draft.start}
                onChange={(e) => setField("start", e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="task-end" className="text-xs text-muted-foreground">
                {t("end")}
              </Label>
              <Input
                id="task-end"
                type="date"
                min={draft.start}
                value={draft.end}
                onChange={(e) => setField("end", e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="task-assignee" className="text-xs text-muted-foreground">
              {t("assignee")}
            </Label>
            <select
              id="task-assignee"
              value={draft.assignedTo}
              onChange={(e) => setField("assignedTo", e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">{t("noAssignee")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving || !draft.title.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : editingId ? (
                <Check className="size-3.5" />
              ) : (
                <Plus className="size-3.5" />
              )}
              {editingId ? t("save") : t("add")}
            </Button>
            {editingId && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={resetForm}
                className="text-muted-foreground"
              >
                {t("cancel")}
              </Button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("loading")}
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((task) => {
            const state = taskState(task, today);
            const who = nameOf(task.assigned_to);
            return (
              <li
                key={task.id}
                className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2"
              >
                <button
                  type="button"
                  disabled={!canWrite}
                  onClick={() => toggleDone(task)}
                  aria-label={task.completed_at ? t("markOpen") : t("markDone")}
                  title={task.completed_at ? t("markOpen") : t("markDone")}
                  className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${
                    task.completed_at
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:border-primary"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {task.completed_at && <Check className="size-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`break-words text-sm ${
                      task.completed_at ? "text-muted-foreground line-through" : "text-foreground"
                    }`}
                  >
                    {task.title}
                  </p>
                  {task.description && (
                    <p className="break-words text-xs text-muted-foreground">{task.description}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${STATE_STYLE[state]}`}
                    >
                      {stateLabel(task, state)}
                    </span>
                    <span>
                      {formatTaskDate(task.start_date, locale)} →{" "}
                      {formatTaskDate(task.end_date, locale)}
                    </span>
                    {who && <span>{t("assignedTo", { name: who })}</span>}
                  </div>
                </div>
                {canWrite && (
                  <div className="flex shrink-0 items-center gap-1">
                    {confirmingId === task.id ? (
                      <span className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => handleDelete(task.id)}
                          className="font-medium text-red-400 hover:underline"
                        >
                          {t("confirmDelete")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
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
                          onClick={() => startEdit(task)}
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
    </div>
  );
}
