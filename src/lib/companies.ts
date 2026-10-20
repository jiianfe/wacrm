import type { Company } from '@/types';

/** Name shown for a company everywhere: trade name first, then legal name. */
export function companyDisplayName(
  company: Pick<Company, 'legal_name' | 'trade_name'> | null | undefined,
): string {
  if (!company) return '';
  return (company.trade_name?.trim() || company.legal_name?.trim() || '');
}
