'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { companyDisplayName } from '@/lib/companies';
import { formatCnpj, normalizeCnpj } from '@/lib/br/documents';
import type { Company, Tag } from '@/types';
import { CompanyForm } from '@/components/companies/company-form';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const PAGE_SIZE = 25;

export default function CompaniesPage() {
  const t = useTranslations('Companies.page');
  const tGate = useTranslations('GatedButton');
  const supabase = createClient();
  const canEdit = useCan('send-messages');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagFilter, setTagFilter] = useState('');
  const [tagsByCompany, setTagsByCompany] = useState<Record<string, Tag[]>>({});

  const [formOpen, setFormOpen] = useState(false);
  const [editCompany, setEditCompany] = useState<Company | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Only the latest fetch may commit its results (fast typing in the
  // search box must not let a slower, older response win).
  const fetchSeq = useRef(0);

  const fetchCompanies = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);

    // Tag filter: resolve the companies that carry the tag first.
    let taggedIds: string[] | null = null;
    if (tagFilter) {
      const { data: tagged } = await supabase
        .from('company_tags')
        .select('company_id')
        .eq('tag_id', tagFilter);
      taggedIds = ((tagged ?? []) as { company_id: string }[]).map((r) => r.company_id);
      if (seq !== fetchSeq.current) return;
      if (taggedIds.length === 0) {
        setCompanies([]);
        setTotalCount(0);
        setTagsByCompany({});
        setLoading(false);
        return;
      }
    }

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    let query = supabase
      .from('companies')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    // Commas/parentheses would break the PostgREST `or()` syntax.
    const term = search.trim().replace(/[,()]/g, ' ').trim();
    if (term) {
      const like = `%${term}%`;
      const cnpjTerm = normalizeCnpj(term);
      const filters = [
        `legal_name.ilike.${like}`,
        `trade_name.ilike.${like}`,
        `address_city.ilike.${like}`,
      ];
      if (cnpjTerm.length >= 3) filters.push(`cnpj.ilike.%${cnpjTerm}%`);
      query = query.or(filters.join(','));
    }

    if (taggedIds) query = query.in('id', taggedIds);

    const { data, count, error } = await query;
    if (seq !== fetchSeq.current) return;
    if (error) {
      toast.error(t('toastFailedLoad'));
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as Company[];

    // Tags of the companies on this page.
    const byCompany: Record<string, Tag[]> = {};
    if (rows.length > 0) {
      const { data: links } = await supabase
        .from('company_tags')
        .select('company_id, tag:tags(id, name, color)')
        .in('company_id', rows.map((r) => r.id));
      for (const link of (links ?? []) as unknown as {
        company_id: string;
        tag: Tag | null;
      }[]) {
        if (link.tag) (byCompany[link.company_id] ??= []).push(link.tag);
      }
    }
    if (seq !== fetchSeq.current) return;

    setCompanies(rows);
    setTagsByCompany(byCompany);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [supabase, page, search, tagFilter, t]);

  useEffect(() => {
    supabase
      .from('tags')
      .select('*')
      .order('name')
      .then(({ data }) => setAllTags((data ?? []) as Tag[]));
  }, [supabase]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  function openAdd() {
    setEditCompany(null);
    setFormOpen(true);
  }

  function openEdit(company: Company) {
    setEditCompany(company);
    setFormOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase
      .from('companies')
      .delete()
      .eq('id', deleteTarget.id);
    setDeleting(false);
    if (error) {
      toast.error(t('toastFailedDelete'));
      return;
    }
    toast.success(t('toastDeleted'));
    setDeleteTarget(null);
    fetchCompanies();
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasSearch = search.trim().length > 0 || tagFilter !== '';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalCount > 0 ? t('subtitle', { count: totalCount }) : t('subtitleZero')}
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason={tGate('reasons.manageCompanies')}
          onClick={openAdd}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="size-4" />
          {t('addBtn')}
        </GatedButton>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={t('searchPlaceholder')}
            className="bg-card border-border pl-8 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        {allTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => {
              setTagFilter(e.target.value);
              setPage(0);
            }}
            aria-label={t('filterByTag')}
            className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus:border-primary"
          >
            <option value="">{t('allTags')}</option>
            {allTags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">{t('columns.name')}</TableHead>
              <TableHead className="text-muted-foreground">{t('columns.cnpj')}</TableHead>
              <TableHead className="hidden text-muted-foreground md:table-cell">
                {t('columns.tags')}
              </TableHead>
              <TableHead className="hidden text-muted-foreground md:table-cell">
                {t('columns.city')}
              </TableHead>
              <TableHead className="hidden text-muted-foreground lg:table-cell">
                {t('columns.phone')}
              </TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={6} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">{t('loading')}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : companies.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={6} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Building2 className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {hasSearch ? t('noMatch') : t('noneYet')}
                    </p>
                    {!hasSearch && (
                      <GatedButton
                        canAct={canEdit}
                        gateReason={tGate('reasons.manageCompanies')}
                        variant="outline"
                        size="sm"
                        onClick={openAdd}
                        className="mt-2 border-border text-muted-foreground hover:bg-muted"
                      >
                        <Plus className="size-3.5" />
                        {t('addFirst')}
                      </GatedButton>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              companies.map((company) => {
                const name = companyDisplayName(company);
                const showLegal =
                  company.legal_name &&
                  company.trade_name &&
                  company.legal_name !== company.trade_name;
                return (
                  <TableRow
                    key={company.id}
                    className="cursor-pointer border-border hover:bg-muted/50"
                    onClick={() => openEdit(company)}
                  >
                    <TableCell className="font-medium text-foreground">
                      <div className="truncate">{name}</div>
                      {showLegal && (
                        <div className="truncate text-xs font-normal text-muted-foreground">
                          {company.legal_name}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {company.cnpj ? formatCnpj(company.cnpj) : '-'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {(tagsByCompany[company.id] ?? []).length > 0 ? (
                          (tagsByCompany[company.id] ?? []).map((tag) => (
                            <span
                              key={tag.id}
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{ backgroundColor: tag.color + '20', color: tag.color }}
                            >
                              {tag.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {company.address_city
                        ? `${company.address_city}${company.address_state ? ` / ${company.address_state}` : ''}`
                        : '-'}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {company.phone || '-'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={(e) => e.stopPropagation()}
                            />
                          }
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-popover border-border">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(company);
                            }}
                            className="text-popover-foreground focus:bg-muted focus:text-foreground"
                          >
                            <Pencil className="size-4" />
                            {t('editAction')}
                          </DropdownMenuItem>
                          {canEdit && (
                            <>
                              <DropdownMenuSeparator className="bg-border" />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget(company);
                                }}
                              >
                                <Trash2 className="size-4" />
                                {t('deleteAction')}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {t('showingPagination', {
              start: page * PAGE_SIZE + 1,
              end: Math.min((page + 1) * PAGE_SIZE, totalCount),
              total: totalCount,
            })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="px-2 text-xs text-muted-foreground">
              {t('pageCount', { page: page + 1, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <CompanyForm
        open={formOpen}
        onOpenChange={setFormOpen}
        company={editCompany}
        onSaved={fetchCompanies}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('deleteTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteDesc', { name: deleteTarget ? companyDisplayName(deleteTarget) : '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {deleting ? t('deleting') : t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
