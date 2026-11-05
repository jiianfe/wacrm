"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Bold, Italic, Link2, Loader2, PenLine, RemoveFormatting, Underline, User } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The company's e-mail signature: a small WYSIWYG editor (bold, italic,
 * underline, colour, size, link, name placeholder). What is saved is
 * sanitized again on the server, so pasted content cannot smuggle in scripts.
 */

const COLORS = ["#1a1a1a", "#c0392b", "#d35400", "#1e8449", "#1f618d", "#6c3483", "#7f8c8d"];
const SIZES: { value: string; key: "small" | "normal" | "large" | "huge" }[] = [
  { value: "2", key: "small" },
  { value: "3", key: "normal" },
  { value: "5", key: "large" },
  { value: "6", key: "huge" },
];

/** Only web, mail and phone links may be inserted. */
function safeHref(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)) return `https://${v}`;
  return null;
}

export function EmailSignature() {
  const t = useTranslations("Settings.email.signature");
  const editor = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [hasMailbox, setHasMailbox] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [initial, setInitial] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/email/signature", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as {
          has_mailbox?: boolean;
          signature_html?: string;
        } | null;
        if (cancelled) return;
        setHasMailbox(body?.has_mailbox !== false);
        setInitial(body?.signature_html ?? "");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fill the editor once, with the already-sanitized stored signature.
  useEffect(() => {
    if (initial === null || !editor.current) return;
    editor.current.innerHTML = initial;
  }, [initial, loading]);

  const run = (command: string, value?: string) => {
    editor.current?.focus();
    document.execCommand(command, false, value);
    setDirty(true);
  };

  const addLink = () => {
    const href = safeHref(window.prompt(t("linkPrompt")) ?? "");
    if (!href) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      run("insertHTML", `<a href="${href.replace(/"/g, "&quot;")}">${href.replace(/^mailto:|^tel:/i, "").replace(/</g, "&lt;")}</a>`);
    } else {
      run("createLink", href);
    }
  };

  const save = useCallback(async () => {
    if (!editor.current) return;
    setSaving(true);
    try {
      const res = await fetch("/api/email/signature", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature_html: editor.current.innerHTML }),
      });
      const body = (await res.json().catch(() => null)) as { signature_html?: string; error?: string } | null;
      if (!res.ok) {
        toast.error(body?.error === "too_long" ? t("tooLong") : body?.error === "no_mailbox" ? t("needMailbox") : t("saveFailed"));
        return;
      }
      // Show what the server kept (it cleans the HTML).
      editor.current.innerHTML = body?.signature_html ?? "";
      setDirty(false);
      toast.success(t("saved"));
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [t]);

  const tool =
    "inline-flex size-8 items-center justify-center rounded-md border border-border bg-muted text-foreground hover:bg-muted/70 disabled:opacity-50";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <PenLine className="size-4 text-primary" />
          {t("title")}
        </CardTitle>
        <CardDescription className="text-muted-foreground">{t.raw("intro")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : !hasMailbox ? (
          <p className="text-sm text-muted-foreground">{t("needMailbox")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={t("toolbar")}>
              <button type="button" className={tool} title={t("bold")} aria-label={t("bold")} onMouseDown={(e) => e.preventDefault()} onClick={() => run("bold")}>
                <Bold className="size-4" />
              </button>
              <button type="button" className={tool} title={t("italic")} aria-label={t("italic")} onMouseDown={(e) => e.preventDefault()} onClick={() => run("italic")}>
                <Italic className="size-4" />
              </button>
              <button type="button" className={tool} title={t("underline")} aria-label={t("underline")} onMouseDown={(e) => e.preventDefault()} onClick={() => run("underline")}>
                <Underline className="size-4" />
              </button>
              <select
                aria-label={t("size")}
                defaultValue="3"
                onChange={(e) => run("fontSize", e.target.value)}
                className="h-8 rounded-md border border-border bg-muted px-1.5 text-xs text-foreground"
              >
                {SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {t(`sizes.${s.key}`)}
                  </option>
                ))}
              </select>
              <span className="flex items-center gap-1" aria-label={t("color")}>
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={`${t("color")} ${c}`}
                    aria-label={`${t("color")} ${c}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => run("foreColor", c)}
                    className="size-5 rounded-full border border-border"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </span>
              <button type="button" className={tool} title={t("link")} aria-label={t("link")} onMouseDown={(e) => e.preventDefault()} onClick={addLink}>
                <Link2 className="size-4" />
              </button>
              <button type="button" className={tool} title={t("clear")} aria-label={t("clear")} onMouseDown={(e) => e.preventDefault()} onClick={() => run("removeFormat")}>
                <RemoveFormatting className="size-4" />
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-muted px-2 text-xs text-foreground hover:bg-muted/70"
                title={t.raw("nameHint")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run("insertText", "{{nome}}")}
              >
                <User className="size-3.5" />
                {t("insertName")}
              </button>
            </div>

            <div
              ref={editor}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label={t("title")}
              onInput={() => setDirty(true)}
              className="min-h-40 rounded-md border border-border bg-white p-3 text-sm leading-normal text-[#1a1a1a] outline-none focus-visible:ring-2 focus-visible:ring-ring [&_a]:text-blue-700 [&_a]:underline"
            />
            <p className="text-xs text-muted-foreground">{t("hint")}</p>

            <Button type="button" onClick={save} disabled={saving || !dirty} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? t("saving") : t("save")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
