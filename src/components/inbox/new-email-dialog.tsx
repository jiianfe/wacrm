"use client";

import { useTranslations } from "next-intl";

import type { Message } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmailComposer } from "./email-composer";

interface NewEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Starting values: recipient, subject, text and files (e.g. a quote PDF). */
  initial?: { to?: string; subject?: string; body?: string; files?: File[] };
  /** The customer's contact, when known, so their CRM documents can be attached. */
  contactId?: string | null;
  onSent?: (message: Message, conversationId: string | null) => void;
}

/** A stand-alone e-mail (not a reply): the first recipient decides the contact and conversation. */
export function NewEmailDialog({ open, onOpenChange, initial, contactId = null, onSent }: NewEmailDialogProps) {
  const t = useTranslations("Inbox.emailComposer");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto bg-popover border-border text-popover-foreground sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("newTitle")}</DialogTitle>
          <DialogDescription>{t("newDescription")}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each new e-mail starts from its own initial values. */}
        {open && (
          <EmailComposer
            embedded
            conversationId={null}
            contactId={contactId}
            contactEmail={null}
            messages={[]}
            initial={initial}
            onSent={(message, conversationId) => {
              onSent?.(message, conversationId);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
