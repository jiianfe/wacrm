"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Briefcase, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineStage } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DealForm } from "@/components/pipelines/deal-form";

interface NewDealButtonProps {
  /** The contact of the open conversation: the deal starts linked to them. */
  contactId: string;
  /** Called after a deal is created, so the contact panel can reload. */
  onCreated?: () => void;
}

/**
 * "Create deal" from a conversation (WhatsApp or e-mail): opens the usual
 * deal form with this conversation's contact — and their company, when they
 * have exactly one — already filled in. With several pipelines the agent
 * picks one first.
 */
export function NewDealButton({ contactId, onCreated }: NewDealButtonProps) {
  const t = useTranslations("Inbox.newDeal");
  const supabase = createClient();

  const [loading, setLoading] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineId, setPipelineId] = useState("");
  const [stages, setStages] = useState<PipelineStage[]>([]);

  async function openFor(id: string) {
    setLoading(true);
    const { data } = await supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", id)
      .order("position");
    setLoading(false);
    const rows = (data ?? []) as PipelineStage[];
    if (rows.length === 0) {
      toast.error(t("noStages"));
      return;
    }
    setPipelineId(id);
    setStages(rows);
    setChooserOpen(false);
    setFormOpen(true);
  }

  async function handleClick() {
    setLoading(true);
    const { data } = await supabase.from("pipelines").select("*").order("created_at");
    setLoading(false);
    const rows = (data ?? []) as Pipeline[];
    if (rows.length === 0) {
      toast.error(t("noPipeline"));
      return;
    }
    setPipelines(rows);
    if (rows.length === 1) {
      await openFor(rows[0].id);
    } else {
      setChooserOpen(true);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleClick}
        disabled={loading}
        title={t("tooltip")}
        className="h-7 gap-1.5 border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Briefcase className="size-3.5" />
        )}
        <span className="hidden sm:inline">{t("button")}</span>
      </Button>

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("choosePipeline")}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("choosePipelineDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {pipelines.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                onClick={() => openFor(p.id)}
                className="w-full justify-start border-border text-foreground hover:bg-muted"
              >
                {p.name}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <DealForm
        open={formOpen}
        onOpenChange={setFormOpen}
        deal={null}
        pipelineId={pipelineId}
        stages={stages}
        defaultStageId={stages[0]?.id}
        presetContactId={contactId}
        onSaved={() => onCreated?.()}
      />
    </>
  );
}
