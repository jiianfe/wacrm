'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { FileDown, FileText, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { downloadQuotePdf } from '@/lib/quotes/download';
import { formatBRL, formatShortDate } from '@/lib/quotes/format';
import type { Quote, QuoteItem, QuoteStatus } from '@/types';
import { QuoteForm } from '@/components/quotes/quote-form';
import { Button } from '@/components/ui/button';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const STATUSES: QuoteStatus[] = ['draft', 'sent', 'approved', 'rejected'];

const STATUS_COLOR: Record<QuoteStatus, string> = {
  draft: 'text-muted-foreground',
  sent: 'text-blue-400',
  approved: 'text-emerald-400',
  rejected: 'text-red-400',
};

const clientName = (q: Quote) =>
  q.client_trade_name || q.client_legal_name || q.contact_name || '';

export default function QuotesPage() {
  const t = useTranslations('Quotes');
  const supabase = createClient();
  const canEdit = useCan('send-messages');

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Quote | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('quotes')
      .select('*')
      .order('number', { ascending: false })
      .limit(500);
    if (error) toast.error(t('page.loadFailed'));
    setQuotes((data ?? []) as Quote[]);
    setLoading(false);
  }, [supabase, t]);

  useEffect(() => {
     
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return quotes;
    return quotes.filter(
      (q) =>
        String(q.number).includes(term) ||
        clientName(q).toLowerCase().includes(term) ||
        (q.client_legal_name ?? '').toLowerCase().includes(term) ||
        (q.client_document ?? '').replace(/\D/g, '').includes(term.replace(/\D/g, '') || '\u0000'),
    );
  }, [quotes, search]);

  async function downloadPdf(quote: Quote, knownItems?: QuoteItem[]) {
    setBusyId(quote.id);
    try {
      let items = knownItems;
      if (!items) {
        const { data, error } = await supabase
          .from('quote_items')
          .select('*')
          .eq('quote_id', quote.id)
          .order('position');
        if (error) throw error;
        items = (data ?? []) as QuoteItem[];
      }
      await downloadQuotePdf(quote, items);
    } catch (err) {
      console.error('Quote PDF failed:', err);
      toast.error(t('page.pdfFailed'));
    } finally {
      setBusyId(null);
    }
  }

  async function changeStatus(quote: Quote, status: QuoteStatus) {
    const { error } = await supabase.from('quotes').update({ status }).eq('id', quote.id);
    if (error) {
      toast.error(t('page.statusFailed'));
      return;
    }
    setQuotes((prev) => prev.map((q) => (q.id === quote.id ? { ...q, status } : q)));
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('quotes').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (error) {
      toast.error(t('page.deleteFailed'));
      return;
    }
    setDeleteTarget(null);
    toast.success(t('page.deleted'));
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('page.searchPlaceholder')}
            className="bg-muted pl-8 text-foreground"
          />
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          disabled={!canEdit}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          {t('page.newQuote')}
        </Button>
      </div>

      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('page.colNumber')}</TableHead>
              <TableHead>{t('page.colClient')}</TableHead>
              <TableHead>{t('page.colDate')}</TableHead>
              <TableHead className="text-right">{t('page.colTotal')}</TableHead>
              <TableHead>{t('page.colStatus')}</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  <FileText className="mx-auto mb-2 h-6 w-6" />
                  {quotes.length === 0 ? t('page.empty') : t('page.noResults')}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="font-medium text-foreground">{q.number}</TableCell>
                  <TableCell>{clientName(q)}</TableCell>
                  <TableCell>{formatShortDate(q.issue_date)}</TableCell>
                  <TableCell className="text-right">{formatBRL(Number(q.total))}</TableCell>
                  <TableCell>
                    <select
                      value={q.status}
                      disabled={!canEdit}
                      onChange={(e) => changeStatus(q, e.target.value as QuoteStatus)}
                      className={`rounded-md border border-border bg-muted px-1.5 py-1 text-xs ${STATUS_COLOR[q.status]}`}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(`status.${s}`)}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => downloadPdf(q)}
                        disabled={busyId === q.id}
                        aria-label={t('page.downloadPdf')}
                        title={t('page.downloadPdf')}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      >
                        {busyId === q.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileDown className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(q);
                          setFormOpen(true);
                        }}
                        disabled={!canEdit}
                        aria-label={t('page.edit')}
                        title={t('page.edit')}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(q)}
                        disabled={!canEdit}
                        aria-label={t('page.delete')}
                        title={t('page.delete')}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <QuoteForm
        open={formOpen}
        onOpenChange={setFormOpen}
        quote={editing}
        onSaved={(quote, items, download) => {
          load();
          if (download) downloadPdf(quote, items);
        }}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(v) => !deleting && !v && setDeleteTarget(null)}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('page.deleteTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('page.deleteDescription', { number: deleteTarget?.number ?? 0 })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              {t('form.cancel')}
            </Button>
            <Button
              disabled={deleting}
              onClick={confirmDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('page.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
