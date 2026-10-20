'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { companyDisplayName } from '@/lib/companies';
import type { CompanyOption } from '@/hooks/use-companies';
import { CompanySelect } from './company-select';

interface CompanyMultiSelectProps {
  id?: string;
  /** Selected company ids. */
  value: string[];
  companies: CompanyOption[];
  onChange: (companyIds: string[]) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * A contact can belong to several companies: the picked ones show as
 * removable chips, and a select below adds another.
 */
export function CompanyMultiSelect({
  id,
  value,
  companies,
  onChange,
  disabled,
  className,
}: CompanyMultiSelectProps) {
  const t = useTranslations('Companies.select');
  const byId = new Map(companies.map((c) => [c.id, c]));

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((companyId) => {
            const name = companyDisplayName(byId.get(companyId)) || t('unknown');
            return (
              <span
                key={companyId}
                className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary"
              >
                {name}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((v) => v !== companyId))}
                    aria-label={t('remove', { name })}
                    className="rounded-full hover:opacity-70"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
      <CompanySelect
        id={id}
        value=""
        companies={companies}
        excludeIds={value}
        emptyLabel={value.length > 0 ? t('addAnother') : t('add')}
        onChange={(companyId) => {
          if (companyId && !value.includes(companyId)) {
            onChange([...value, companyId]);
          }
        }}
        disabled={disabled}
        className={className}
      />
    </div>
  );
}
