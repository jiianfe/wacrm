"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { ReceivableStatus } from "@/lib/finance/finance";

const COLORS: Record<ReceivableStatus, string> = {
  open: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  partial: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  overdue: "bg-red-500/15 text-red-600 dark:text-red-300",
  paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status, className }: { status: ReceivableStatus; className?: string }) {
  const t = useTranslations("Finance.status");
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", COLORS[status], className)}>
      {t(status)}
    </span>
  );
}
