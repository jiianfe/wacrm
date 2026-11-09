"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import type { TaskNote } from "@/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_NOTE_CHARS = 10000;

/**
 * Notes of a task as a timeline: each keeps the date, time and author. Notes
 * are append-only (the author or an admin can delete one, never edit it), so
 * the dates stay true.
 */
export function TaskNotes({ taskId, onChanged }: { taskId: string; onChanged?: () => void }) {
  const t = useTranslations("Tasks.notes");
  const locale = useLocale();
  const supabase = useMemo(() => createClient(), []);
  const { accountId, profile, user } = useAuth();
  const canWrite = useCan("send-messages");
  const isAdmin = useCan("edit-settings");
  const canDelete = (n: TaskNote) => isAdmin || (!!n.user_id && n.user_id === user?.id);

  const [notes, setNotes] = useState<TaskNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("task_notes")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false });
    if (error) toast.error(t("loadFailed"));
    setNotes((data ?? []) as TaskNote[]);
    setLoading(false);
  }, [supabase, taskId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function add() {
    const body = text.trim();
    if (!body || !accountId || !user?.id) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("task_notes")
      .insert({
        task_id: taskId,
        account_id: accountId,
        user_id: user.id,
        author_name: profile?.full_name || profile?.email || null,
        body,
      })
      .select("*")
      .single();
    setSaving(false);
    if (error || !data) return toast.error(t("saveFailed"));
    setNotes((prev) => [data as TaskNote, ...prev]);
    setText("");
    onChanged?.();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("task_notes").delete().eq("id", id);
    if (error) return toast.error(t("deleteFailed"));
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setConfirmingId(null);
    onChanged?.();
  }

  const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="grid gap-2">
      <span className="text-xs text-muted-foreground">{t("title")}</span>

      {canWrite && (
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_NOTE_CHARS))}
            placeholder={t("placeholder")}
            className="min-h-[64px] border-border bg-muted text-foreground"
          />
          <Button type="button" size="sm" onClick={add} disabled={saving || !text.trim()}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {t("add")}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="group rounded-lg border border-border bg-muted/50 px-3 py-2">
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">{n.body}</p>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  {formatWhen(n.created_at)}
                  {n.author_name ? ` · ${n.author_name}` : ""}
                </span>
                {canWrite &&
                  canDelete(n) &&
                  (confirmingId === n.id ? (
                    <span className="flex items-center gap-2">
                      <button type="button" onClick={() => remove(n.id)} className="font-medium text-red-400 hover:underline">
                        {t("confirmDelete")}
                      </button>
                      <button type="button" onClick={() => setConfirmingId(null)} className="hover:text-foreground">
                        {t("cancel")}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(n.id)}
                      aria-label={t("delete")}
                      className="opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
