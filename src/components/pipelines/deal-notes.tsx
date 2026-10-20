"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import type { DealNote } from "@/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MAX_NOTE_CHARS = 10000;

/**
 * The notes of a deal as a timeline: every note keeps the date and time it
 * was written and who wrote it. Notes are append-only (they can be deleted
 * by their author or an admin, never edited), so the dates stay true.
 */
export function DealNotes({ dealId }: { dealId: string }) {
  const t = useTranslations("Pipelines.notes");
  const locale = useLocale();
  const supabase = createClient();
  const { accountId, profile, user } = useAuth();
  const canWrite = useCan("send-messages");
  // The database lets only the author or an admin delete a note.
  const isAdmin = useCan("edit-settings");
  const canDelete = (n: DealNote) => isAdmin || (!!n.user_id && n.user_id === user?.id);

  const [notes, setNotes] = useState<DealNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("deal_notes")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });
    if (error) toast.error(t("loadFailed"));
    setNotes((data ?? []) as DealNote[]);
    setLoading(false);
  }, [supabase, dealId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleAdd() {
    const body = text.trim();
    if (!body || !accountId) return;
    setSaving(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      toast.error(t("notSignedIn"));
      setSaving(false);
      return;
    }
    const { data, error } = await supabase
      .from("deal_notes")
      .insert({
        deal_id: dealId,
        account_id: accountId,
        user_id: userId,
        author_name: profile?.full_name || profile?.email || null,
        body,
      })
      .select("*")
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(t("saveFailed"));
      return;
    }
    setNotes((prev) => [data as DealNote, ...prev]);
    setText("");
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from("deal_notes").delete().eq("id", id);
    if (error) {
      toast.error(t("deleteFailed"));
      return;
    }
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setConfirmingId(null);
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
      <Label className="text-muted-foreground">{t("title")}</Label>

      {canWrite && (
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_NOTE_CHARS))}
            placeholder={t("placeholder")}
            className="min-h-[72px] border-border bg-muted text-foreground"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleAdd}
            disabled={saving || !text.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {t("add")}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("loading")}
        </div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="group rounded-lg border border-border bg-muted/50 px-3 py-2"
            >
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                {n.body}
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  {formatWhen(n.created_at)}
                  {n.author_name ? ` · ${n.author_name}` : ""}
                </span>
                {canWrite &&
                  canDelete(n) &&
                  (confirmingId === n.id ? (
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDelete(n.id)}
                        className="font-medium text-red-400 hover:underline"
                      >
                        {t("confirmDelete")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="hover:text-foreground"
                      >
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
