"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileText, Loader2, Paperclip, Send, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { formatBytes } from "@/lib/deal-documents";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  replyRecipients,
  replySubject,
} from "@/lib/email/compose";
import type { Message } from "@/types";
import { Button } from "@/components/ui/button";

interface CrmDocument {
  id: string;
  file_name: string;
  size_bytes: number | null;
  category: string;
}

interface EmailComposerProps {
  /** The conversation being answered; null writes a new e-mail (the first recipient decides the contact). */
  conversationId: string | null;
  contactId: string | null;
  contactEmail: string | null;
  /** The conversation's messages, used to prefill the recipient and subject. */
  messages: Message[];
  onSent: (message: Message, conversationId: string | null) => void;
  /** New-mail starting values (recipient, subject, text, files such as a quote PDF). */
  initial?: { to?: string; subject?: string; body?: string; files?: File[] };
  /** Called with the box's height-neutral layout when shown inside a dialog. */
  embedded?: boolean;
  /** A click on Reply / Reply all of a received mail; a new `id` fills the box again. */
  replyRequest?: { id: number; message: Message; all: boolean } | null;
}

interface ContactOption {
  id: string;
  name: string | null;
  email: string;
}

const SIGNATURE_KEY = "wacrm.emailSignature.";

/**
 * Reply box of the e-mail view. Sends through the account's own mailbox
 * (SMTP), answering the latest received mail of the conversation.
 */
export function EmailComposer({
  conversationId,
  contactId,
  contactEmail,
  messages,
  onSent,
  initial,
  embedded = false,
  replyRequest,
}: EmailComposerProps) {
  const t = useTranslations("Inbox.emailComposer");
  const { user } = useAuth();
  const canSend = useCan("send-messages");

  const lastReceived = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.channel === "email" && m.sender_type === "customer") return m;
    }
    return null;
  }, [messages]);

  const touched = useRef({ to: !!initial?.to, subject: initial?.subject !== undefined });
  const isNew = conversationId === null;
  const [to, setTo] = useState(initial?.to ?? (lastReceived?.email_from || contactEmail || ""));
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(
    initial?.subject ?? (isNew ? "" : replySubject(lastReceived?.email_subject)),
  );
  const [body, setBody] = useState(initial?.body ?? "");
  const [files, setFiles] = useState<File[]>(initial?.files ?? []);
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);
  // The received mail being answered; the latest one unless the agent picked another.
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [ownAddress, setOwnAddress] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Our own mailbox address, to leave it out of "reply to all".
  useEffect(() => {
    let cancelled = false;
    fetch("/api/email/mailbox", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { address?: string } | null) => {
        if (!cancelled) setOwnAddress(d?.address ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Reply / Reply all on a received mail fills recipients, copy and subject.
  const requestId = replyRequest?.id;
  useEffect(() => {
    if (!replyRequest) return;
    const m = replyRequest.message;
    const r = replyRecipients({
      from: m.email_from,
      to: m.email_to,
      cc: m.email_cc,
      own: ownAddress,
      all: replyRequest.all,
    });
    touched.current = { to: true, subject: true };
    setTo(r.to || m.email_from || "");
    setCc(r.cc);
    setShowCc(!!r.cc);
    setSubject(replySubject(m.email_subject));
    setReplyToId(m.id);
    requestAnimationFrame(() => bodyRef.current?.focus());
    // Only a new click (id) should refill the box; the address arriving later must not wipe edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);
  const [crmDocs, setCrmDocs] = useState<CrmDocument[]>([]);
  const [chosenDocs, setChosenDocs] = useState<string[]>([]);
  const [docsOpen, setDocsOpen] = useState(false);
  const [signature, setSignature] = useState(true);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Messages may arrive after the box mounts (or a new mail may come in):
  // refresh the suggested recipient and subject unless the agent edited them.
  const lastId = lastReceived?.id;
  const lastFrom = lastReceived?.email_from;
  const lastSubject = lastReceived?.email_subject;
  useEffect(() => {
    if (isNew) return;
    if (!touched.current.to) setTo(lastFrom || contactEmail || "");
    if (!touched.current.subject) setSubject(replySubject(lastSubject));
  }, [isNew, lastId, lastFrom, lastSubject, contactEmail]);

  // A new e-mail offers the contacts that have an address.
  useEffect(() => {
    if (!isNew) return;
    let cancelled = false;
    createClient()
      .from("contacts")
      .select("id, name, email")
      .not("email", "is", null)
      .neq("email", "")
      .order("name")
      .limit(500)
      .then(({ data }) => {
        if (!cancelled) setContactOptions((data ?? []) as ContactOption[]);
      });
    return () => {
      cancelled = true;
    };
  }, [isNew]);

  // The contact whose documents can be attached: the conversation's, or the one the typed address belongs to.
  const firstTo = to.split(/[,;]/)[0]?.trim().toLowerCase() ?? "";
  const effectiveContactId = isNew
    ? (contactId ?? contactOptions.find((c) => c.email.toLowerCase() === firstTo)?.id ?? null)
    : contactId;

  // The preference is per person and lives in this browser.
  useEffect(() => {
    if (!user?.id) return;
    try {
      setSignature(window.localStorage.getItem(SIGNATURE_KEY + user.id) !== "0");
    } catch {
      // Storage blocked: keep the default.
    }
  }, [user?.id]);
  const toggleSignature = (on: boolean) => {
    setSignature(on);
    if (!user?.id) return;
    try {
      window.localStorage.setItem(SIGNATURE_KEY + user.id, on ? "1" : "0");
    } catch {
      // The toggle still works for this session.
    }
  };

  // Documents attached to this customer's deals (quotes, invoices, boletos).
  useEffect(() => {
    if (!effectiveContactId) {
      setCrmDocs([]);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data: deals } = await supabase.from("deals").select("id").eq("contact_id", effectiveContactId);
      const ids = ((deals ?? []) as { id: string }[]).map((d) => d.id);
      if (!ids.length) return;
      const { data: docs } = await supabase
        .from("deal_attachments")
        .select("id, file_name, size_bytes, category")
        .in("deal_id", ids)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) setCrmDocs((docs ?? []) as CrmDocument[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveContactId]);

  const chosenCrm = crmDocs.filter((d) => chosenDocs.includes(d.id));
  const attachmentCount = files.length + chosenCrm.length;
  const totalBytes =
    files.reduce((n, f) => n + f.size, 0) + chosenCrm.reduce((n, d) => n + (d.size_bytes ?? 0), 0);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    if (next.length + chosenCrm.length > MAX_ATTACHMENTS) {
      toast.error(t("tooManyFiles", { max: MAX_ATTACHMENTS }));
      return;
    }
    setFiles(next);
    if (fileInput.current) fileInput.current.value = "";
  };

  const send = useCallback(async () => {
    if (sending) return;
    if (!to.trim()) return toast.error(t("needRecipient"));
    if (!body.trim()) return toast.error(t("needBody"));
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      return toast.error(t("tooBig", { mb: MAX_ATTACHMENT_BYTES / 1024 / 1024 }));
    }
    setSending(true);
    try {
      const form = new FormData();
      if (conversationId) form.set("conversation_id", conversationId);
      form.set("to", to);
      form.set("cc", cc);
      form.set("subject", subject);
      form.set("body", body);
      form.set("signature", signature ? "1" : "0");
      const answering = replyToId ?? lastReceived?.id;
      if (answering) form.set("reply_to_message_id", answering);
      form.set("crm_attachment_ids", JSON.stringify(chosenCrm.map((d) => d.id)));
      for (const f of files) form.append("files", f, f.name);

      const res = await fetch("/api/email/send", { method: "POST", body: form });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload?.error || t("sendFailed"));
        return;
      }
      onSent(payload.message as Message, (payload.conversation_id as string | undefined) ?? conversationId);
      toast.success(t("sent"));
      setBody("");
      setCc("");
      setFiles([]);
      setChosenDocs([]);
    } catch {
      toast.error(t("sendFailed"));
    } finally {
      setSending(false);
    }
  }, [sending, to, cc, subject, body, signature, files, chosenCrm, totalBytes, conversationId, lastReceived, replyToId, onSent, t]);

  if (!canSend) {
    return (
      <div className="shrink-0 border-t border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        {t("readOnly")}
      </div>
    );
  }

  const field = "w-full min-w-0 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground";

  return (
    <div
      className={
        embedded
          ? "space-y-1.5"
          : "shrink-0 space-y-1.5 border-t border-border bg-background px-4 py-3"
      }
    >
      {isNew && (
        <datalist id="email-contacts">
          {contactOptions.map((c) => (
            <option key={c.id} value={c.email}>
              {c.name ?? ""}
            </option>
          ))}
        </datalist>
      )}
      <div className="flex items-center gap-2 border-b border-border/60">
        <label className="w-14 shrink-0 text-xs text-muted-foreground" htmlFor="email-to">
          {t("to")}
        </label>
        <input
          id="email-to"
          className={field}
          list={isNew ? "email-contacts" : undefined}
          value={to}
          onChange={(e) => {
            touched.current.to = true;
            setTo(e.target.value);
          }}
          placeholder={t("toPlaceholder")}
          inputMode="email"
        />
        {!showCc && (
          <button
            type="button"
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowCc(true)}
          >
            Cc
          </button>
        )}
      </div>
      {showCc && (
        <div className="flex items-center gap-2 border-b border-border/60">
          <label className="w-14 shrink-0 text-xs text-muted-foreground" htmlFor="email-cc">
            Cc
          </label>
          <input
            id="email-cc"
            className={field}
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder={t("ccPlaceholder")}
            inputMode="email"
          />
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-border/60">
        <label className="w-14 shrink-0 text-xs text-muted-foreground" htmlFor="email-subject">
          {t("subject")}
        </label>
        <input
          id="email-subject"
          className={field}
          value={subject}
          maxLength={300}
          onChange={(e) => {
            touched.current.subject = true;
            setSubject(e.target.value);
          }}
        />
      </div>

      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder={t("bodyPlaceholder")}
        className="max-h-60 min-h-24 w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {attachmentCount > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs"
            >
              <Paperclip className="size-3 shrink-0" />
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
              <button
                type="button"
                aria-label={t("remove")}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {chosenCrm.map((d) => (
            <span
              key={d.id}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs"
            >
              <FileText className="size-3 shrink-0" />
              <span className="truncate">{d.file_name}</span>
              <button
                type="button"
                aria-label={t("remove")}
                onClick={() => setChosenDocs(chosenDocs.filter((id) => id !== d.id))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {docsOpen && (
        <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border bg-muted/40 p-1.5">
          {crmDocs.length === 0 ? (
            <p className="px-1 py-1 text-xs text-muted-foreground">{t("noCrmDocs")}</p>
          ) : (
            crmDocs.map((d) => {
              const on = chosenDocs.includes(d.id);
              return (
                <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      if (!on && attachmentCount >= MAX_ATTACHMENTS) {
                        toast.error(t("tooManyFiles", { max: MAX_ATTACHMENTS }));
                        return;
                      }
                      setChosenDocs(on ? chosenDocs.filter((id) => id !== d.id) : [...chosenDocs, d.id]);
                    }}
                  />
                  <span className="truncate">{d.file_name}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">{formatBytes(d.size_bytes)}</span>
                </label>
              );
            })
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          <Paperclip className="size-4" />
          {t("attachFile")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setDocsOpen((o) => !o)} aria-expanded={docsOpen}>
          <FileText className="size-4" />
          {t("attachCrm")}
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={signature} onChange={(e) => toggleSignature(e.target.checked)} />
          {t("signature")}
        </label>
        <Button type="button" size="sm" className="ml-auto" disabled={sending} onClick={send}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {t("send")}
        </Button>
      </div>
    </div>
  );
}
