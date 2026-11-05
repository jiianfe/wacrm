"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, ImageOff, Loader2, Paperclip } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface EmailReaderProps {
  message: Message;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The page the sandboxed iframe shows. Scripts cannot run (no `allow-scripts`
 * on the iframe) and the CSP only lets embedded (data:) images through; remote
 * images are allowed only after the reader asks for them.
 */
function buildDocument(body: string, allowRemoteImages: boolean): string {
  const img = allowRemoteImages ? "img-src data: https: http:" : "img-src data:";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${img}; style-src 'unsafe-inline'">
<base target="_blank">
<style>
  body { margin: 16px; font: 14px/1.5 Arial, Helvetica, sans-serif; color: #1a1a1a; background: #fff; word-wrap: break-word; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  blockquote { margin: 8px 0 8px 4px; padding-left: 12px; border-left: 3px solid #ccc; color: #555; }
  pre.plain { white-space: pre-wrap; font: inherit; margin: 0; }
</style></head><body>${body}</body></html>`;
}

/**
 * Reads a received e-mail the way a webmail would: full header, the original
 * formatting (sanitized HTML in a sandboxed frame) and the attachment list.
 * Attachment files are not stored by the CRM; each click fetches the file
 * from the mailbox.
 */
export function EmailReader({ message, open, onOpenChange }: EmailReaderProps) {
  const t = useTranslations("Inbox.emailReader");

  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remoteImages, setRemoteImages] = useState(false);

  useEffect(() => {
    if (!open || !message.email_has_html) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    createClient()
      .from("email_message_bodies")
      .select("html")
      .eq("message_id", message.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setHtml((data as { html: string } | null)?.html ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, message.id, message.email_has_html]);

  const srcDoc = useMemo(() => {
    const body = html ?? `<pre class="plain">${escapeHtml(message.content_text ?? "")}</pre>`;
    return buildDocument(body, remoteImages);
  }, [html, message.content_text, remoteImages]);

  const sent = new Date(message.created_at).toLocaleString();
  const fromLine = message.email_from_name
    ? `${message.email_from_name} <${message.email_from ?? ""}>`
    : (message.email_from ?? "");
  const attachments = message.email_attachments ?? [];
  const hasRemote = !!html && /<img[^>]+src="https?:/i.test(html);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 bg-popover border-border text-popover-foreground sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="break-words pr-6 text-popover-foreground">
            {message.email_subject || t("noSubject")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("description")}</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">{t("from")}</dt>
          <dd className="break-all text-foreground">{fromLine}</dd>
          {message.email_to && (
            <>
              <dt className="text-muted-foreground">{t("to")}</dt>
              <dd className="break-all text-foreground">{message.email_to}</dd>
            </>
          )}
          {message.email_cc && (
            <>
              <dt className="text-muted-foreground">{t("cc")}</dt>
              <dd className="break-all text-foreground">{message.email_cc}</dd>
            </>
          )}
          <dt className="text-muted-foreground">{t("date")}</dt>
          <dd className="text-foreground">{sent}</dd>
        </dl>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border-y border-border py-2">
            {attachments.map((a) => (
              <a
                key={a.index}
                href={`/api/email/attachment?message=${encodeURIComponent(message.id)}&index=${a.index}`}
                download
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground hover:bg-muted/70"
                title={t("downloadHint")}
              >
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.filename}</span>
                <span className="shrink-0 text-muted-foreground">{formatSize(a.size)}</span>
                <Download className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        )}

        {hasRemote && !remoteImages && (
          <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ImageOff className="size-3.5" />
              {t("imagesBlocked")}
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => setRemoteImages(true)}>
              {t("loadImages")}
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-white">
          {loading ? (
            <div className="flex h-[60vh] items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <iframe
              title={message.email_subject || t("noSubject")}
              srcDoc={srcDoc}
              // No allow-scripts and no allow-same-origin: the mail can neither
              // run code nor touch the CRM. Popups let links open in a new tab.
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              className="h-[60vh] w-full"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
