'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Check, Loader2, MessageSquare, Search, UserPlus, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { syncContactCompanyText } from '@/lib/company-links';
import {
  BR_STATES,
  formatCep,
  formatCnpj,
  isValidCnpj,
  normalizeCep,
  normalizeCnpj,
} from '@/lib/br/documents';
import type { Company, CustomField, Tag } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const FIELDS = [
  'legal_name',
  'trade_name',
  'cnpj',
  'state_registration',
  'municipal_registration',
  'phone',
  'email',
  'website',
  'address_zip',
  'address_street',
  'address_number',
  'address_complement',
  'address_district',
  'address_city',
  'address_state',
  'notes',
] as const;

type Field = (typeof FIELDS)[number];
type Form = Record<Field, string>;

const EMPTY: Form = Object.fromEntries(FIELDS.map((f) => [f, ''])) as Form;

const INPUT_CLASS =
  'bg-muted border-border text-foreground placeholder:text-muted-foreground';

/** A contact linked to the company, with the role they have there. */
interface LinkedContact {
  id: string;
  name: string | null;
  phone: string;
  job_title: string;
}
interface LinkedDeal {
  id: string;
  title: string;
  status: string | null;
}

/**
 * Search box that finds the account's contacts by name or phone and adds
 * one to the company. Contacts already linked are left out of the results.
 */
function ContactPicker({
  excludeIds,
  onPick,
}: {
  excludeIds: string[];
  onPick: (contact: { id: string; name: string | null; phone: string }) => void;
}) {
  const t = useTranslations('Companies.form');
  const supabase = createClient();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<
    { id: string; name: string | null; phone: string }[]
  >([]);

  useEffect(() => {
    // Commas/parentheses would break the PostgREST `or()` syntax.
    const q = term.trim().replace(/[,()]/g, ' ').trim();
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const like = `%${q}%`;
      const { data } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .neq('registration_status', 'pending')
        .or(`name.ilike.${like},phone.ilike.${like}`)
        .order('name')
        .limit(8);
      if (cancelled) return;
      setResults(
        ((data ?? []) as { id: string; name: string | null; phone: string }[]).filter(
          (c) => !excludeIds.includes(c.id),
        ),
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, excludeIds, supabase]);

  return (
    <div className="relative">
      <UserPlus className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={t('addContactPlaceholder')}
        className={`${INPUT_CLASS} pl-8`}
      />
      {term.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t('noContactsFound')}</p>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onPick(c);
                  setTerm('');
                  setResults([]);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="truncate text-foreground">{c.name || t('unnamed')}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{c.phone}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface CompanyFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: Company | null;
  onSaved: () => void;
  /** Values to start a NEW company with (e.g. from an inbound e-mail). */
  prefill?: Partial<Record<Field, string>>;
  /** A contact to link as soon as a NEW company is saved. */
  presetContact?: { id: string; name: string | null; phone: string } | null;
}

export function CompanyForm({
  open,
  onOpenChange,
  company,
  onSaved,
  prefill,
  presetContact,
}: CompanyFormProps) {
  const t = useTranslations('Companies.form');
  const supabase = createClient();
  const { accountId } = useAuth();
  const isEdit = !!company;

  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  // `contacts` is what the user is editing; `initialContacts` is what is
  // saved, so the save can work out what to add, remove or retitle.
  const [contacts, setContacts] = useState<LinkedContact[]>([]);
  const [initialContacts, setInitialContacts] = useState<LinkedContact[]>([]);
  // contact id -> conversation id, for the "open conversation" shortcut.
  const [conversationByContact, setConversationByContact] = useState<Record<string, string>>({});
  const [deals, setDeals] = useState<LinkedDeal[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [initialTagIds, setInitialTagIds] = useState<string[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [initialCustomValues, setInitialCustomValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const next = { ...EMPTY };
    if (company) {
      for (const f of FIELDS) next[f] = company[f] ?? '';
      next.cnpj = formatCnpj(next.cnpj);
      next.address_zip = formatCep(next.address_zip);
    } else if (prefill) {
      for (const f of FIELDS) if (prefill[f]) next[f] = prefill[f]!;
    }
    setForm(next);
    // A new company can start with one contact already linked; it counts as
    // "added" on save because `initialContacts` stays empty.
    setContacts(
      !company && presetContact
        ? [{ id: presetContact.id, name: presetContact.name, phone: presetContact.phone, job_title: '' }]
        : [],
    );
    setInitialContacts([]);
    setDeals([]);
  }, [open, company, prefill, presetContact]);

  // Contacts and deals already linked to this company (edit mode only).
  useEffect(() => {
    if (!open || !company) return;
    let cancelled = false;
    (async () => {
      const [c, d] = await Promise.all([
        supabase
          .from('company_contacts')
          .select('job_title, contact:contacts(id, name, phone)')
          .eq('company_id', company.id)
          .limit(200),
        supabase
          .from('deals')
          .select('id, title, status')
          .eq('company_id', company.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (cancelled) return;
      const linked = (
        (c.data ?? []) as unknown as {
          job_title: string | null;
          contact: { id: string; name: string | null; phone: string } | null;
        }[]
      )
        .filter((row) => row.contact)
        .map((row) => ({
          id: row.contact!.id,
          name: row.contact!.name,
          phone: row.contact!.phone,
          job_title: row.job_title ?? '',
        }))
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
      setContacts(linked);
      setInitialContacts(linked);
      setDeals((d.data ?? []) as LinkedDeal[]);

      if (linked.length > 0) {
        const { data: convs } = await supabase
          .from('conversations')
          .select('id, contact_id')
          .in('contact_id', linked.map((c) => c.id));
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const row of (convs ?? []) as { id: string; contact_id: string }[]) {
          map[row.contact_id] = row.id;
        }
        setConversationByContact(map);
      } else {
        setConversationByContact({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, company, supabase]);

  // Tag and custom-field definitions, plus this company's assignments.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [tagsRes, fieldsRes, companyTagsRes, valuesRes] = await Promise.all([
        supabase.from('tags').select('*').order('name'),
        supabase.from('custom_fields').select('*').order('field_name'),
        company
          ? supabase.from('company_tags').select('tag_id').eq('company_id', company.id)
          : Promise.resolve({ data: [] as { tag_id: string }[] }),
        company
          ? supabase
              .from('company_custom_values')
              .select('custom_field_id, value')
              .eq('company_id', company.id)
          : Promise.resolve({ data: [] as { custom_field_id: string; value: string | null }[] }),
      ]);
      if (cancelled) return;
      setAllTags((tagsRes.data ?? []) as Tag[]);
      setCustomFields((fieldsRes.data ?? []) as CustomField[]);
      const ids = ((companyTagsRes.data ?? []) as { tag_id: string }[]).map((r) => r.tag_id);
      setTagIds(ids);
      setInitialTagIds(ids);
      const values: Record<string, string> = {};
      for (const v of (valuesRes.data ?? []) as {
        custom_field_id: string;
        value: string | null;
      }[]) {
        values[v.custom_field_id] = v.value ?? '';
      }
      setCustomValues(values);
      setInitialCustomValues(values);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, company, supabase]);

  function set(field: Field, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleTag(tagId: string) {
    setTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  }

  async function handleLookup() {
    const cnpj = normalizeCnpj(form.cnpj);
    if (!isValidCnpj(cnpj)) {
      toast.error(t('cnpjInvalid'));
      return;
    }
    setLookingUp(true);
    try {
      const res = await fetch(`/api/companies/cnpj-lookup?cnpj=${cnpj}`, {
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => null)) as {
        data?: Record<string, string | null>;
        error?: string;
      } | null;
      if (!res.ok || !body?.data) {
        const code = body?.error;
        toast.error(
          code === 'not_found'
            ? t('lookupNotFound')
            : code === 'invalid'
              ? t('cnpjInvalid')
              : t('lookupUnavailable'),
        );
        return;
      }
      const data = body.data;
      // Only fill what is still empty: never overwrite what was typed.
      setForm((prev) => {
        const next = { ...prev };
        for (const f of FIELDS) {
          if (f === 'cnpj' || f === 'notes') continue;
          const incoming = data[f];
          if (incoming && !prev[f].trim()) {
            next[f] = f === 'address_zip' ? formatCep(incoming) : incoming;
          }
        }
        return next;
      });
      toast.success(t('lookupFilled'));
      const situation = data.situation?.trim();
      if (situation && situation.toUpperCase() !== 'ATIVA') {
        toast.warning(t('lookupInactive', { situation }));
      }
    } catch {
      toast.error(t('lookupUnavailable'));
    } finally {
      setLookingUp(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.legal_name.trim() && !form.trade_name.trim()) {
      toast.error(t('nameRequired'));
      return;
    }
    const cnpj = normalizeCnpj(form.cnpj);
    if (cnpj && !isValidCnpj(cnpj)) {
      toast.error(t('cnpjInvalid'));
      return;
    }
    const zip = normalizeCep(form.address_zip);
    if (zip && zip.length !== 8) {
      toast.error(t('zipInvalid'));
      return;
    }
    const email = form.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error(t('emailInvalid'));
      return;
    }

    const clean = (v: string) => v.trim() || null;
    const payload = {
      legal_name: clean(form.legal_name),
      trade_name: clean(form.trade_name),
      cnpj: cnpj || null,
      state_registration: clean(form.state_registration),
      municipal_registration: clean(form.municipal_registration),
      phone: clean(form.phone),
      email: email || null,
      website: clean(form.website),
      address_zip: zip || null,
      address_street: clean(form.address_street),
      address_number: clean(form.address_number),
      address_complement: clean(form.address_complement),
      address_district: clean(form.address_district),
      address_city: clean(form.address_city),
      address_state: clean(form.address_state),
      notes: clean(form.notes),
    };

    setSaving(true);
    try {
      let companyId = company?.id;
      if (isEdit && companyId) {
        const { error } = await supabase
          .from('companies')
          .update(payload)
          .eq('id', companyId);
        if (error) throw error;
      } else {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) throw new Error(t('notAuthenticated'));
        if (!accountId) throw new Error(t('notLinkedToAccount'));
        const { data, error } = await supabase
          .from('companies')
          .insert({ ...payload, account_id: accountId, user_id: user.id })
          .select('id')
          .single();
        if (error) throw error;
        companyId = data.id;
      }

      // Tags: write only the difference.
      if (companyId) {
        const tagsToAdd = tagIds.filter((id) => !initialTagIds.includes(id));
        const tagsToRemove = initialTagIds.filter((id) => !tagIds.includes(id));
        if (tagsToRemove.length > 0) {
          const { error } = await supabase
            .from('company_tags')
            .delete()
            .eq('company_id', companyId)
            .in('tag_id', tagsToRemove);
          if (error) throw error;
        }
        if (tagsToAdd.length > 0) {
          const { error } = await supabase
            .from('company_tags')
            .insert(tagsToAdd.map((tag_id) => ({ company_id: companyId, tag_id })));
          if (error) throw error;
        }

        // Custom fields: rewrite the values only when something changed.
        const norm = (v: Record<string, string>) =>
          JSON.stringify(
            Object.entries(v)
              .map(([k, val]) => [k, val.trim()] as const)
              .filter(([, val]) => val)
              .sort(([a], [b]) => a.localeCompare(b)),
          );
        if (norm(customValues) !== norm(initialCustomValues)) {
          const { error: delError } = await supabase
            .from('company_custom_values')
            .delete()
            .eq('company_id', companyId);
          if (delError) throw delError;
          const rows = Object.entries(customValues)
            .filter(([, val]) => val.trim())
            .map(([custom_field_id, val]) => ({
              company_id: companyId,
              custom_field_id,
              value: val.trim(),
            }));
          if (rows.length > 0) {
            const { error } = await supabase.from('company_custom_values').insert(rows);
            if (error) throw error;
          }
        }
      }

      // Sync the linked contacts: add the new ones, drop the removed ones,
      // update changed job titles.
      if (companyId && accountId) {
        const before = new Map(initialContacts.map((c) => [c.id, c]));
        const now = new Map(contacts.map((c) => [c.id, c]));
        const removed = initialContacts.filter((c) => !now.has(c.id));
        const added = contacts.filter((c) => !before.has(c.id));
        const retitled = contacts.filter(
          (c) => before.has(c.id) && before.get(c.id)!.job_title.trim() !== c.job_title.trim(),
        );

        if (removed.length > 0) {
          const { error } = await supabase
            .from('company_contacts')
            .delete()
            .eq('company_id', companyId)
            .in('contact_id', removed.map((c) => c.id));
          if (error) throw error;
        }
        if (added.length > 0) {
          const { error } = await supabase.from('company_contacts').insert(
            added.map((c) => ({
              company_id: companyId,
              contact_id: c.id,
              account_id: accountId,
              job_title: c.job_title.trim() || null,
            })),
          );
          if (error) throw error;
        }
        for (const c of retitled) {
          const { error } = await supabase
            .from('company_contacts')
            .update({ job_title: c.job_title.trim() || null })
            .eq('company_id', companyId)
            .eq('contact_id', c.id);
          if (error) throw error;
        }

        // `contacts.company` (free text shown in lists and the inbox)
        // mirrors the companies' names, so refresh every contact touched
        // here — and all current ones, since the name may have changed.
        await syncContactCompanyText(supabase, [
          ...contacts.map((c) => c.id),
          ...removed.map((c) => c.id),
        ]);
      }

      toast.success(isEdit ? t('toastUpdated') : t('toastCreated'));
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        toast.error(t('cnpjDuplicate'));
        return;
      }
      toast.error(err instanceof Error ? err.message : t('toastFailed'));
    } finally {
      setSaving(false);
    }
  }

  function field(
    name: Field,
    label: string,
    opts: {
      placeholder?: string;
      className?: string;
      onChange?: (value: string) => string;
      inputMode?: 'numeric' | 'tel' | 'email' | 'url' | 'text';
      required?: boolean;
    } = {},
  ) {
    return (
      <div className={`space-y-2 ${opts.className ?? ''}`}>
        <Label htmlFor={`cmp-${name}`} className="text-muted-foreground">
          {label}
        </Label>
        <Input
          id={`cmp-${name}`}
          value={form[name]}
          onChange={(e) =>
            set(name, opts.onChange ? opts.onChange(e.target.value) : e.target.value)
          }
          placeholder={opts.placeholder}
          inputMode={opts.inputMode}
          className={INPUT_CLASS}
        />
      </div>
    );
  }

  const section = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {isEdit ? t('titleEdit') : t('titleAdd')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isEdit ? t('descEdit') : t('descAdd')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-3">
            <p className={section}>{t('identity')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cmp-cnpj" className="text-muted-foreground">
                  {t('cnpj')}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="cmp-cnpj"
                    value={form.cnpj}
                    onChange={(e) => set('cnpj', formatCnpj(e.target.value))}
                    placeholder="00.000.000/0000-00"
                    className={INPUT_CLASS}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleLookup}
                    disabled={lookingUp || !form.cnpj.trim()}
                    className="shrink-0 border-border text-muted-foreground hover:bg-muted"
                  >
                    {lookingUp ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Search className="size-4" />
                    )}
                    {lookingUp ? t('lookingUp') : t('lookupBtn')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('cnpjHint')}</p>
              </div>
              {field('legal_name', t('legalName'), { className: 'sm:col-span-2' })}
              {field('trade_name', t('tradeName'), { className: 'sm:col-span-2' })}
              {field('state_registration', t('stateRegistration'))}
              {field('municipal_registration', t('municipalRegistration'))}
            </div>
          </div>

          <div className="space-y-3">
            <p className={section}>{t('contact')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('phone', t('phone'), { placeholder: '(85) 90000-0000', inputMode: 'tel' })}
              {field('email', t('email'), { inputMode: 'email' })}
              {field('website', t('website'), {
                placeholder: 'https://',
                inputMode: 'url',
                className: 'sm:col-span-2',
              })}
            </div>
          </div>

          <div className="space-y-3">
            <p className={section}>{t('address')}</p>
            <div className="grid gap-4 sm:grid-cols-6">
              {field('address_zip', t('zip'), {
                placeholder: '00000-000',
                inputMode: 'numeric',
                onChange: formatCep,
                className: 'sm:col-span-2',
              })}
              {field('address_street', t('street'), { className: 'sm:col-span-4' })}
              {field('address_number', t('number'), { className: 'sm:col-span-2' })}
              {field('address_complement', t('complement'), { className: 'sm:col-span-4' })}
              {field('address_district', t('district'), { className: 'sm:col-span-3' })}
              {field('address_city', t('city'), { className: 'sm:col-span-2' })}
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="cmp-address_state" className="text-muted-foreground">
                  {t('state')}
                </Label>
                <select
                  id="cmp-address_state"
                  value={form.address_state}
                  onChange={(e) => set('address_state', e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  <option value="">{t('stateSelect')}</option>
                  {BR_STATES.map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cmp-notes" className="text-muted-foreground">
              {t('notes')}
            </Label>
            <Textarea
              id="cmp-notes"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder={t('notesPlaceholder')}
              rows={3}
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-3">
            <p className={section}>{t('tagsTitle')}</p>
            {allTags.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('noTagsAvailable')}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((tag) => {
                  const selected = tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={`inline-flex cursor-pointer items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
                        selected
                          ? 'ring-2 ring-primary ring-offset-1 ring-offset-border'
                          : 'opacity-50 hover:opacity-80'
                      }`}
                      style={{ backgroundColor: tag.color + '20', color: tag.color }}
                    >
                      {selected && <Check className="mr-1 size-3" />}
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <p className={section}>{t('customFieldsTitle')}</p>
            {customFields.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('noCustomFields')}</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {customFields.map((cf) => (
                  <div key={cf.id} className="space-y-2">
                    <Label htmlFor={`cmp-cf-${cf.id}`} className="text-muted-foreground">
                      {cf.field_name}
                    </Label>
                    <Input
                      id={`cmp-cf-${cf.id}`}
                      value={customValues[cf.id] ?? ''}
                      onChange={(e) =>
                        setCustomValues((prev) => ({ ...prev, [cf.id]: e.target.value }))
                      }
                      className={INPUT_CLASS}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <p className={section}>{t('contactsTitle')}</p>
            <ContactPicker
              excludeIds={contacts.map((c) => c.id)}
              onPick={(c) =>
                setContacts((prev) => [
                  ...prev,
                  { id: c.id, name: c.name, phone: c.phone, job_title: '' },
                ])
              }
            />
            {contacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('noContactsLinked')}</p>
            ) : (
              <ul className="space-y-2">
                {contacts.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">
                        {c.name || t('unnamed')}
                      </p>
                      <p className="text-xs text-muted-foreground">{c.phone}</p>
                      {conversationByContact[c.id] && (
                        <Link
                          href={`/inbox?c=${conversationByContact[c.id]}`}
                          className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <MessageSquare className="size-3" />
                          {t('openConversation')}
                        </Link>
                      )}
                    </div>
                    <Input
                      value={c.job_title}
                      onChange={(e) =>
                        setContacts((prev) =>
                          prev.map((x) =>
                            x.id === c.id ? { ...x, job_title: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder={t('jobTitlePlaceholder')}
                      aria-label={t('jobTitle')}
                      className={`${INPUT_CLASS} h-8 w-36 text-xs sm:w-44`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setContacts((prev) => prev.filter((x) => x.id !== c.id))
                      }
                      aria-label={t('removeContact', { name: c.name || c.phone })}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isEdit && deals.length > 0 && (
            <div className="space-y-2">
              <p className={section}>{t('linkedDeals', { count: deals.length })}</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {deals.map((d) => (
                  <li key={d.id} className="truncate">
                    {d.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter className="bg-popover border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
