"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import {
  Banknote,
  FileText,
  Loader2,
  Paperclip,
  Receipt,
  Trash2,
  Download,
  type LucideIcon,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import {
  DEAL_DOC_ACCEPT,
  DEAL_DOC_CATEGORIES,
  DEAL_DOC_MAX_BYTES,
  buildDealDocumentPath,
  formatBytes,
  resolveDocumentMime,
} from "@/lib/deal-documents";
import type { DealAttachment, DealDocumentCategory } from "@/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const BUCKET = "deal-documents";
/** How long a download link stays valid. */
const SIGNED_URL_SECONDS = 60;

const CATEGORY_ICON: Record<DealDocumentCategory, LucideIcon> = {
  quote: FileText,
  invoice: Receipt,
  boleto: Banknote,
  other: Paperclip,
};

/**
 * Documents attached to a deal — quotes, invoices (NF), boletos... Files go
 * to a private bucket and are opened through short-lived signed links, so
 * nothing is publicly reachable. Each file keeps who added it and when.
 */
export function DealAttachments({
  dealId,
  onChanged,
}: {
  dealId: string;
  /** Called after a document is added or removed (e.g. to refresh the card's paperclip). */
  onChanged?: () => void;
}) {
  const t = useTranslations("Pipelines.documents");
  const locale = useLocale();
  const supabase = createClient();
  const { accountId, profile, user } = useAuth();
  const canWrite = useCan("send-messages");
  const isAdmin = useCan("edit-settings");
  const canDelete = (a: DealAttachment) =>
    isAdmin || (!!a.user_id && a.user_id === user?.id);

  const fileInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<DealAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState<DealDocumentCategory>("quote");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("deal_attachments")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });
    if (error) toast.error(t("loadFailed"));
    setItems((data ?? []) as DealAttachment[]);
    setLoading(false);
  }, [supabase, dealId, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (fileInput.current) fileInput.current.value = "";
    if (!file || !accountId) return;

    if (file.size > DEAL_DOC_MAX_BYTES) {
      toast.error(t("tooLarge", { max: formatBytes(DEAL_DOC_MAX_BYTES) }));
      return;
    }
    const mime = resolveDocumentMime(file);
    if (!mime) {
      toast.error(t("typeNotAllowed"));
      return;
    }

    setUploading(true);
    const path = buildDealDocumentPath(accountId, dealId, file.name);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error("not signed in");

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: mime, upsert: false });
      if (uploadError) throw uploadError;

      const { data, error: insertError } = await supabase
        .from("deal_attachments")
        .insert({
          deal_id: dealId,
          account_id: accountId,
          user_id: userId,
          author_name: profile?.full_name || profile?.email || null,
          file_name: file.name.slice(0, 255),
          storage_path: path,
          mime_type: mime,
          size_bytes: file.size,
          category,
        })
        .select("*")
        .single();
      if (insertError || !data) {
        // Don't leave an orphan file behind.
        await supabase.storage.from(BUCKET).remove([path]);
        throw insertError ?? new Error("insert failed");
      }
      setItems((prev) => [data as DealAttachment, ...prev]);
      toast.success(t("uploaded"));
      onChanged?.();
    } catch {
      toast.error(t("uploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  // Open the file in a new tab (PDFs and images show right in the browser;
  // other types are downloaded by it). The tab is opened synchronously, on
  // the click, because browsers block pop-ups opened after an `await`; its
  // address is filled in once the short-lived link is ready.
  async function handleOpen(item: DealAttachment) {
    const win = window.open("", "_blank");
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(item.storage_path, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) {
      win?.close();
      toast.error(t("downloadFailed"));
      return;
    }
    if (!win) {
      // Pop-ups are blocked: fall back to a plain download.
      await handleDownload(item);
      return;
    }
    win.opener = null;
    win.location.href = data.signedUrl;
  }

  async function handleDownload(item: DealAttachment) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(item.storage_path, SIGNED_URL_SECONDS, {
        download: item.file_name,
      });
    if (error || !data?.signedUrl) {
      toast.error(t("downloadFailed"));
      return;
    }
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = item.file_name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleDelete(item: DealAttachment) {
    // Row first: the table policy is what decides who may delete.
    const { error } = await supabase.from("deal_attachments").delete().eq("id", item.id);
    if (error) {
      toast.error(t("deleteFailed"));
      return;
    }
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
      <Label className="text-muted-foreground">{t("title")}</Label>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as DealDocumentCategory)}
            aria-label={t("categoryLabel")}
            disabled={uploading}
            className="h-8 rounded-lg border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
          >
            {DEAL_DOC_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`category.${c}`)}
              </option>
            ))}
          </select>
          <input
            ref={fileInput}
            type="file"
            accept={DEAL_DOC_ACCEPT}
            onChange={(e) => handleFiles(e.target.files)}
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
            {uploading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Paperclip className="size-3.5" />
            )}
            {uploading ? t("uploading") : t("attach")}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {t("limits", { max: formatBytes(DEAL_DOC_MAX_BYTES) })}
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("loading")}
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => {
            const Icon = CATEGORY_ICON[a.category] ?? Paperclip;
            return (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2"
              >
                <Icon className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => handleOpen(a)}
                    title={t("open")}
                    className="block max-w-full truncate text-left text-sm text-foreground hover:text-primary hover:underline"
                  >
                    {a.file_name}
                  </button>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {t(`category.${a.category}`)}
                    {a.size_bytes != null ? ` · ${formatBytes(a.size_bytes)}` : ""}
                    {` · ${formatWhen(a.created_at)}`}
                    {a.author_name ? ` · ${a.author_name}` : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDownload(a)}
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
                      <button
                        type="button"
                        onClick={() => handleDelete(a)}
                        className="font-medium text-red-400 hover:underline"
                      >
                        {t("confirmDelete")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="text-muted-foreground hover:text-foreground"
                      >
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
