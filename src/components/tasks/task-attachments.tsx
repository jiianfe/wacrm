"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { Download, FileText, ImageIcon, Loader2, Paperclip, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import {
  DEAL_DOC_ACCEPT,
  DEAL_DOC_MAX_BYTES,
  buildDealDocumentPath,
  formatBytes,
  resolveDocumentMime,
} from "@/lib/deal-documents";
import type { TaskAttachment } from "@/types";
import { Button } from "@/components/ui/button";

// Same private bucket as deal documents; files sit under account-<id>/tasks/<task>/.
const BUCKET = "deal-documents";
const SIGNED_URL_SECONDS = 60;

/** Documents and photos on a task, opened through short-lived signed links. */
export function TaskAttachments({ taskId, onChanged }: { taskId: string; onChanged?: () => void }) {
  const t = useTranslations("Tasks.files");
  const locale = useLocale();
  const supabase = useMemo(() => createClient(), []);
  const { accountId, profile, user } = useAuth();
  const canWrite = useCan("send-messages");
  const isAdmin = useCan("edit-settings");
  const canDelete = (a: TaskAttachment) => isAdmin || (!!a.user_id && a.user_id === user?.id);

  const fileInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<TaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("task_attachments")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false });
    if (error) toast.error(t("loadFailed"));
    setItems((data ?? []) as TaskAttachment[]);
    setLoading(false);
  }, [supabase, taskId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function upload(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (fileInput.current) fileInput.current.value = "";
    if (!list.length || !accountId || !user?.id) return;

    setUploading(true);
    let done = 0;
    for (const file of list) {
      if (file.size > DEAL_DOC_MAX_BYTES) {
        toast.error(t("tooLarge", { name: file.name, max: formatBytes(DEAL_DOC_MAX_BYTES) }));
        continue;
      }
      const mime = resolveDocumentMime(file);
      if (!mime) {
        toast.error(t("typeNotAllowed", { name: file.name }));
        continue;
      }
      const path = buildDealDocumentPath(accountId, `tasks/${taskId}`, file.name);
      try {
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: mime, upsert: false });
        if (upErr) throw upErr;
        const { data, error: insErr } = await supabase
          .from("task_attachments")
          .insert({
            task_id: taskId,
            account_id: accountId,
            user_id: user.id,
            author_name: profile?.full_name || profile?.email || null,
            file_name: file.name.slice(0, 255),
            storage_path: path,
            mime_type: mime,
            size_bytes: file.size,
          })
          .select("*")
          .single();
        if (insErr || !data) {
          await supabase.storage.from(BUCKET).remove([path]); // no orphan file
          throw insErr ?? new Error("insert failed");
        }
        setItems((prev) => [data as TaskAttachment, ...prev]);
        done += 1;
      } catch {
        toast.error(t("uploadFailed", { name: file.name }));
      }
    }
    setUploading(false);
    if (done) {
      toast.success(t("uploaded", { count: done }));
      onChanged?.();
    }
  }

  // The tab opens on the click itself (pop-up blockers), then gets the link.
  async function open(item: TaskAttachment) {
    const win = window.open("", "_blank");
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(item.storage_path, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) {
      win?.close();
      return toast.error(t("downloadFailed"));
    }
    if (!win) return download(item);
    win.opener = null;
    win.location.href = data.signedUrl;
  }

  async function download(item: TaskAttachment) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(item.storage_path, SIGNED_URL_SECONDS, { download: item.file_name });
    if (error || !data?.signedUrl) return toast.error(t("downloadFailed"));
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = item.file_name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function remove(item: TaskAttachment) {
    // Row first: the table policy decides who may delete.
    const { error } = await supabase.from("task_attachments").delete().eq("id", item.id);
    if (error) return toast.error(t("deleteFailed"));
    await supabase.storage.from(BUCKET).remove([item.storage_path]);
    setItems((prev) => prev.filter((a) => a.id !== item.id));
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
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={DEAL_DOC_ACCEPT}
            onChange={(e) => upload(e.target.files)}
            className="hidden"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="border-border text-foreground hover:bg-muted"
          >
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
            {uploading ? t("uploading") : t("attach")}
          </Button>
          <span className="text-[11px] text-muted-foreground">{t("limits", { max: formatBytes(DEAL_DOC_MAX_BYTES) })}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => {
            const Icon = a.mime_type?.startsWith("image/") ? ImageIcon : FileText;
            return (
              <li key={a.id} className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2">
                <Icon className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => open(a)}
                    title={t("open")}
                    className="block max-w-full truncate text-left text-sm text-foreground hover:text-primary hover:underline"
                  >
                    {a.file_name}
                  </button>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {a.size_bytes != null ? `${formatBytes(a.size_bytes)} · ` : ""}
                    {formatWhen(a.created_at)}
                    {a.author_name ? ` · ${a.author_name}` : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => download(a)}
                  aria-label={t("download")}
                  title={t("download")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Download className="size-4" />
                </Button>
                {canWrite &&
                  canDelete(a) &&
                  (confirmingId === a.id ? (
                    <span className="flex items-center gap-2 text-[11px]">
                      <button type="button" onClick={() => remove(a)} className="font-medium text-red-400 hover:underline">
                        {t("confirmDelete")}
                      </button>
                      <button type="button" onClick={() => setConfirmingId(null)} className="text-muted-foreground hover:text-foreground">
                        {t("cancel")}
                      </button>
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setConfirmingId(a.id)}
                      aria-label={t("delete")}
                      title={t("delete")}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
