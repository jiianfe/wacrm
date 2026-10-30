"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DeleteConversationButtonProps {
  conversationId: string;
  /** The conversation is gone — drop it from the list and close the thread. */
  onDeleted: (conversationId: string) => void;
}

/**
 * Deletes the open conversation and all of its messages, after a
 * confirmation. The contact, their company and any deals stay: a deal that
 * pointed at this conversation just loses that link (the column has no
 * ON DELETE rule, so it is cleared first). Media files already sent stay in
 * storage. If the customer writes again, a fresh conversation starts.
 */
export function DeleteConversationButton({
  conversationId,
  onDeleted,
}: DeleteConversationButtonProps) {
  const t = useTranslations("Inbox.deleteConversation");
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    setDeleting(true);
    const supabase = createClient();
    const { error: unlinkError } = await supabase
      .from("deals")
      .update({ conversation_id: null })
      .eq("conversation_id", conversationId);
    if (unlinkError) {
      setDeleting(false);
      toast.error(t("failed"));
      return;
    }
    const { error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", conversationId);
    setDeleting(false);
    if (error) {
      toast.error(t("failed"));
      return;
    }
    setOpen(false);
    toast.success(t("deleted"));
    onDeleted(conversationId);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("button")}
        title={t("button")}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <Dialog open={open} onOpenChange={(v) => !deleting && setOpen(v)}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setOpen(false)}
              className="border-border text-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              disabled={deleting}
              onClick={confirmDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
