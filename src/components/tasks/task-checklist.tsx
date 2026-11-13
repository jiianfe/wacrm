"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import type { TaskChecklistItem } from "@/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/** Checklist of a task (e.g. materials to buy): tick each item when done. */
export function TaskChecklist({ taskId, onChanged }: { taskId: string; onChanged?: () => void }) {
  const t = useTranslations("Tasks.checklist");
  const supabase = useMemo(() => createClient(), []);
  const { accountId, user } = useAuth();
  const canWrite = useCan("send-messages");

  const [items, setItems] = useState<TaskChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("task_checklist_items")
      .select("*")
      .eq("task_id", taskId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) toast.error(t("loadFailed"));
    setItems((data ?? []) as TaskChecklistItem[]);
    setLoading(false);
  }, [supabase, taskId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function add() {
    const label = text.trim();
    if (!label || !accountId) return;
    setAdding(true);
    const position = items.reduce((m, i) => Math.max(m, i.position), 0) + 1;
    const { data, error } = await supabase
      .from("task_checklist_items")
      .insert({ task_id: taskId, account_id: accountId, user_id: user?.id ?? null, label, position })
      .select("*")
      .single();
    setAdding(false);
    if (error || !data) return toast.error(t("saveFailed"));
    setItems((prev) => [...prev, data as TaskChecklistItem]);
    setText("");
    onChanged?.();
  }

  async function toggle(item: TaskChecklistItem, done: boolean) {
    const done_at = done ? new Date().toISOString() : null;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done, done_at } : i)));
    const { error } = await supabase.from("task_checklist_items").update({ done, done_at }).eq("id", item.id);
    if (error) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
      return toast.error(t("saveFailed"));
    }
    onChanged?.();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("task_checklist_items").delete().eq("id", id);
    if (error) return toast.error(t("deleteFailed"));
    setItems((prev) => prev.filter((i) => i.id !== id));
    onChanged?.();
  }

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="grid gap-2">
      <span className="text-xs text-muted-foreground">
        {t("title")}
        {items.length > 0 && ` (${doneCount}/${items.length})`}
      </span>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
              <Checkbox
                checked={i.done}
                disabled={!canWrite}
                onCheckedChange={(v) => toggle(i, v === true)}
                aria-label={i.label}
              />
              <span
                className={`min-w-0 flex-1 break-words text-sm ${
                  i.done ? "text-muted-foreground line-through" : "text-foreground"
                }`}
              >
                {i.label}
              </span>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => remove(i.id)}
                  aria-label={t("delete")}
                  className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <div className="flex gap-2">
          <input
            value={text}
            maxLength={300}
            placeholder={t("placeholder")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="button" size="sm" onClick={add} disabled={adding || !text.trim()}>
            {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {t("add")}
          </Button>
        </div>
      )}
    </div>
  );
}
