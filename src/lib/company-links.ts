import type { createClient } from '@/lib/supabase/client';
import { companyDisplayName } from '@/lib/companies';

type Supabase = ReturnType<typeof createClient>;

/** One contact↔company link as the forms edit it. */
export interface CompanyLink {
  company_id: string;
  job_title: string | null;
}

/** Company ids a contact is linked to. */
export async function loadContactCompanyIds(
  supabase: Supabase,
  contactId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('company_contacts')
    .select('company_id')
    .eq('contact_id', contactId);
  return ((data ?? []) as { company_id: string }[]).map((r) => r.company_id);
}

/**
 * `contacts.company` is the free-text company shown in lists, the inbox
 * sidebar and CSV exports. It mirrors the names of the linked companies
 * ("Acme, Globex"), or null when the contact has none.
 */
export async function syncContactCompanyText(
  supabase: Supabase,
  contactIds: string[],
): Promise<void> {
  const ids = [...new Set(contactIds)];
  if (ids.length === 0) return;

  const { data } = await supabase
    .from('company_contacts')
    .select('contact_id, company:companies(legal_name, trade_name)')
    .in('contact_id', ids);

  const names = new Map<string, string[]>();
  for (const row of (data ?? []) as unknown as {
    contact_id: string;
    company: { legal_name: string | null; trade_name: string | null } | null;
  }[]) {
    const name = companyDisplayName(row.company);
    if (!name) continue;
    names.set(row.contact_id, [...(names.get(row.contact_id) ?? []), name]);
  }

  await Promise.all(
    ids.map((id) =>
      supabase
        .from('contacts')
        .update({ company: (names.get(id) ?? []).sort().join(', ') || null })
        .eq('id', id),
    ),
  );
}

/**
 * Make a contact's company links match `companyIds` (adds the new ones,
 * removes the dropped ones, keeps job titles of the rest) and refresh the
 * contact's free-text company. A no-op when nothing changed, so a contact
 * that only has a legacy free-text company is left alone.
 */
export async function replaceContactCompanies(
  supabase: Supabase,
  accountId: string,
  contactId: string,
  companyIds: string[],
): Promise<void> {
  const wanted = new Set(companyIds);
  const current = new Set(await loadContactCompanyIds(supabase, contactId));

  const toAdd = [...wanted].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !wanted.has(id));
  if (toAdd.length === 0 && toRemove.length === 0) return;

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('company_contacts')
      .delete()
      .eq('contact_id', contactId)
      .in('company_id', toRemove);
    if (error) throw error;
  }
  if (toAdd.length > 0) {
    const { error } = await supabase.from('company_contacts').insert(
      toAdd.map((company_id) => ({
        company_id,
        contact_id: contactId,
        account_id: accountId,
      })),
    );
    if (error) throw error;
  }

  await syncContactCompanyText(supabase, [contactId]);
}
