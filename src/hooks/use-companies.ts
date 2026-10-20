'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { companyDisplayName } from '@/lib/companies';
import type { Company } from '@/types';

export type CompanyOption = Pick<Company, 'id' | 'legal_name' | 'trade_name' | 'cnpj'>;

/**
 * Loads the account's companies (id, names, CNPJ) for pickers — the
 * contact form and the deal form. RLS scopes the read to the caller's
 * account. Sorted by display name. Pass `enabled=false` to defer the
 * fetch until a dialog/sheet is actually open.
 */
export function useCompanies(enabled = true) {
  const supabase = createClient();
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('companies')
      .select('id, legal_name, trade_name, cnpj');
    const rows = ((data ?? []) as CompanyOption[]).sort((a, b) =>
      companyDisplayName(a).localeCompare(companyDisplayName(b)),
    );
    setCompanies(rows);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [enabled, reload]);

  return { companies, loading, reload };
}
