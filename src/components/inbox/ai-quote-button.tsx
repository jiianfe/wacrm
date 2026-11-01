"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { FileText, Loader2 } from "lucide-react";

import type { Contact } from "@/types";
import type { QuoteDraft } from "@/lib/ai/quote-draft";
import { downloadQuotePdf } from "@/lib/quotes/download";
import { Button } from "@/components/ui/button";
import { QuoteForm, type QuotePrefill } from "@/components/quotes/quote-form";

interface AiQuoteButtonProps {
  conversationId: string;
  contact: Contact;
}

/**
 * "Quote with AI": reads the conversation, matches what the customer asked
 * for against the product catalog and opens the regular quote form already
 * filled in. Nothing is saved or sent until the agent confirms in the form.
 */
export function AiQuoteButton({ conversationId, contact }: AiQuoteButtonProps) {
  const t = useTranslations("Inbox.aiQuote");

  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<QuoteDraft | null>(null);

  async function start() {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/quote-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? t("failed"));
        return;
      }
      const result = data.draft as QuoteDraft;
      if (result.items.length === 0) toast.info(t("noItems"));
      setDraft(result);
      setFormOpen(true);
    } catch {
      toast.error(t("failed"));
    } finally {
      setLoading(false);
    }
  }

  const prefill = useMemo<QuotePrefill>(
    () => ({
      contactId: contact.id,
      contactName: contact.name ?? null,
      contactEmail: contact.email ?? null,
      contactPhone: contact.phone ?? null,
      notes: draft?.notes ?? null,
      items: draft?.items ?? [],
    }),
    [contact, draft],
  );

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={start}
        disabled={loading}
        title={t("tooltip")}
        className="h-7 gap-1.5 border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
        <span className="hidden sm:inline">{t("button")}</span>
      </Button>

      <QuoteForm
        open={formOpen}
        onOpenChange={setFormOpen}
        quote={null}
        prefill={prefill}
        onSaved={(quote, items, download) => {
          toast.success(t("saved", { number: quote.number }));
          if (download) downloadQuotePdf(quote, items).catch(() => toast.error(t("pdfFailed")));
        }}
      />
    </>
  );
}
