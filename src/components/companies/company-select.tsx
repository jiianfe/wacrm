'use client';

import { useTranslations } from 'next-intl';
import { companyDisplayName } from '@/lib/companies';
import { formatCnpj } from '@/lib/br/documents';
import type { CompanyOption } from '@/hooks/use-companies';

interface CompanySelectProps {
  id?: string;
  value: string;
  companies: CompanyOption[];
  onChange: (companyId: string) => void;
  disabled?: boolean;
  className?: string;
  /** Text of the empty option. Defaults to "No company". */
  emptyLabel?: string;
  /** Companies to leave out of the list (already picked elsewhere). */
  excludeIds?: string[];
}

/**
 * Native select over the account's companies, shared by the contact and
 * deal forms. An empty value means "no company".
 */
export function CompanySelect({
  id,
  value,
  companies,
  onChange,
  disabled,
  className,
  emptyLabel,
  excludeIds,
}: CompanySelectProps) {
  const t = useTranslations('Companies.select');

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={
        className ??
        'h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60'
      }
    >
      <option value="">{emptyLabel ?? t('none')}</option>
      {companies
        .filter((c) => !excludeIds?.includes(c.id))
        .map((c) => (
          <option key={c.id} value={c.id}>
            {companyDisplayName(c)}
            {c.cnpj ? ` — ${formatCnpj(c.cnpj)}` : ''}
          </option>
        ))}
    </select>
  );
}
