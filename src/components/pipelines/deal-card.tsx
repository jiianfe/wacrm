"use client";

import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useLocale, useTranslations } from "next-intl";
import { companyDisplayName } from "@/lib/companies";
import { formatTaskDate, localDateString, summarizeTasks } from "@/lib/deal-tasks";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string, locale: string) {
  return new Date(dateStr).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const locale = useLocale();
  const contactName = deal.contact?.name || deal.contact?.phone || null;
  const contactLabel = contactName
    ? t("contact", { name: contactName })
    : t("noContact");
  const companyName = companyDisplayName(deal.company) || null;
  const assigneeLabel = deal.assignee?.full_name || null;
  const attachmentCount = deal.attachments?.[0]?.count ?? 0;
  // Tasks only matter while the deal is open: green = an open task is within
  // its period, red = an open task's end date has passed.
  const taskSummary =
    deal.status === "won" || deal.status === "lost"
      ? null
      : summarizeTasks(deal.tasks, localDateString());
  const taskOverdue = taskSummary?.status === "overdue";
  const taskUpcoming = taskSummary?.status === "upcoming";

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {deal.title}
        </h4>
        {attachmentCount > 0 && (
          <span
            title={t("attachments", { count: attachmentCount })}
            aria-label={t("attachments", { count: attachmentCount })}
            className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground"
          >
            <span aria-hidden>📎</span>
            {attachmentCount > 1 ? attachmentCount : null}
          </span>
        )}
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            {t("won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            {t("lost")}
          </span>
        )}
      </div>

      {taskSummary && taskSummary.status !== "none" && taskSummary.date && (
        <div className="mt-2">
          <span
            className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              taskOverdue
                ? "bg-red-500/15 text-red-400"
                : taskUpcoming
                  ? "bg-muted-foreground/15 text-muted-foreground"
                  : "bg-emerald-500/15 text-emerald-400"
            }`}
          >
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${
                taskOverdue
                  ? "bg-red-400"
                  : taskUpcoming
                    ? "bg-muted-foreground"
                    : "bg-emerald-400"
              }`}
            />
            <span className="truncate">
              {taskOverdue
                ? t("tasksOverdue", {
                    count: taskSummary.overdue,
                    date: formatTaskDate(taskSummary.date, locale),
                  })
                : taskUpcoming
                  ? t("tasksUpcoming", {
                      count: taskSummary.upcoming,
                      date: formatTaskDate(taskSummary.date, locale),
                    })
                  : t("tasksActive", {
                      count: taskSummary.active,
                      date: formatTaskDate(taskSummary.date, locale),
                    })}
            </span>
          </span>
        </div>
      )}

      {companyName && (
        <div className="mt-2">
          <span
            title={companyName}
            className="block truncate text-xs font-medium text-foreground"
          >
            {t("company", { name: companyName })}
          </span>
        </div>
      )}

      {/* Contact row */}
      <div className={companyName ? "mt-1" : "mt-2"}>
        <span
          title={contactName ?? undefined}
          className="block truncate text-xs text-muted-foreground"
        >
          {contactLabel}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-bold text-primary">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.expected_close_date && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date, locale)}
          </span>
        )}
      </div>

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="max-w-full truncate text-[11px] text-muted-foreground"
          >
            {t("assignee", { name: assigneeLabel })}
          </span>
        </div>
      )}
    </button>
  );
}
