'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { FileDown, FileText, Loader2, Mail, Pencil, Plus, Search, Send, Trash2, Wallet } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { downloadQuotePdf, pickQuotePdfHandle, renderQuotePdf, sendQuotePdfViaWhatsApp, type PdfSaveHandle } from '@/lib/quotes/download';
import { NewEmailDialog } from '@/components/inbox/new-email-dialog';
import { ReceivableDialog, type ReceivablePrefill } from '@/components/finance/receivable-dialog';
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
  const [fNumber, setFNumber] = useState('');
  const [fCnpj, setFCnpj] = useState('');
  const [fContact, setFContact] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fStatus, setFStatus] = useState<'' | QuoteStatus>('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Quote | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sendTarget, setSendTarget] = useState<{
    quote: Quote;
    name: string;
    phone: string;
    contactId: string;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [receivableDraft, setReceivableDraft] = useState<ReceivablePrefill | null>(null);
  const [emailDraft, setEmailDraft] = useState<{
    contactId: string;
    initial: { to: string; subject: string; body: string; files: File[] };
  } | null>(null);

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

  const hasFilters = !!(fNumber || fCnpj || fContact || fFrom || fTo || fStatus);
  const clearFilters = () => {
    setFNumber('');
    setFCnpj('');
    setFContact('');
    setFFrom('');
    setFTo('');
    setFStatus('');
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const cnpjDigits = fCnpj.replace(/\D/g, '');
    const contactTerm = fContact.trim().toLowerCase();
    const numberTerm = fNumber.replace(/\D/g, '');
    return quotes.filter((q) => {
      if (fStatus && q.status !== fStatus) return false;
      if (numberTerm && !String(q.number).includes(numberTerm)) return false;
      if (cnpjDigits && !(q.client_document ?? '').replace(/\D/g, '').includes(cnpjDigits)) return false;
      if (contactTerm && !(q.contact_name ?? '').toLowerCase().includes(contactTerm)) return false;
      // issue_date is a plain YYYY-MM-DD, so string comparison is a date comparison.
      if (fFrom && q.issue_date < fFrom) return false;
      if (fTo && q.issue_date > fTo) return false;
      if (!term) return true;
      return (
        String(q.number).includes(term) ||
        clientName(q).toLowerCase().includes(term) ||
        (q.client_legal_name ?? '').toLowerCase().includes(term) ||
        (q.client_document ?? '').replace(/\D/g, '').includes(term.replace(/\D/g, '') || '\u0000')
      );
    });
  }, [quotes, search, fNumber, fCnpj, fContact, fFrom, fTo, fStatus]);

  async function downloadPdf(quote: Quote, knownItems?: QuoteItem[]) {
    // Ask where to save first: the dialog needs the click that started this.
    let handle: PdfSaveHandle | null = null;
    try {
      handle = await pickQuotePdfHandle(quote);
    } catch {
      return; // cancelled
    }
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
      await downloadQuotePdf(quote, items, handle);
    } catch (err) {
      console.error('Quote PDF failed:', err);
      toast.error(t('page.pdfFailed'));
    } finally {
      setBusyId(null);
    }
  }

  /** Looks up the quote's contact and asks for confirmation before anything is sent. */
  async function askSend(quote: Quote) {
    if (!quote.contact_id) {
      toast.error(t('page.sendNoContact'));
      return;
    }
    const { data } = await supabase
      .from('contacts')
      .select('id, name, phone')
      .eq('id', quote.contact_id)
      .maybeSingle();
    const contact = data as { id: string; name: string | null; phone: string | null } | null;
    if (!contact?.phone) {
      toast.error(t('page.sendNoPhone'));
      return;
    }
    setSendTarget({
      quote,
      name: contact.name || quote.contact_name || '',
      phone: contact.phone,
      contactId: contact.id,
    });
  }

  /** Builds the quote PDF and opens a ready-to-edit e-mail to the quote's contact; nothing is sent until the agent clicks Send. */
  async function askEmail(quote: Quote) {
    if (!quote.contact_id) {
      toast.error(t('page.sendNoContact'));
      return;
    }
    setBusyId(quote.id);
    try {
      const { data: contact } = await supabase
        .from('contacts')
        .select('id, name, email')
        .eq('id', quote.contact_id)
        .maybeSingle();
      const c = contact as { id: string; name: string | null; email: string | null } | null;
      if (!c?.email) {
        toast.error(t('page.sendNoEmail'));
        return;
      }
      const { data: itemRows, error } = await supabase
        .from('quote_items')
        .select('*')
        .eq('quote_id', quote.id)
        .order('position');
      if (error) throw error;
      const { bytes, fileName } = await renderQuotePdf(quote, (itemRows ?? []) as QuoteItem[]);
      const file = new File([bytes as BlobPart], fileName, { type: 'application/pdf' });
      setEmailDraft({
        contactId: c.id,
        initial: {
          to: c.email,
          subject: t('page.emailSubject', { number: quote.number }),
          body: t('page.emailBody', { name: c.name || quote.contact_name || '', number: quote.number }),
          files: [file],
        },
      });
    } catch (err) {
      console.error('Quote e-mail draft failed:', err);
      toast.error(t('page.pdfFailed'));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmSend() {
    if (!sendTarget) return;
    const { quote, contactId } = sendTarget;
    setSending(true);
    try {
      const { data, error } = await supabase
        .from('quote_items')
        .select('*')
        .eq('quote_id', quote.id)
        .order('position');
      if (error) throw error;
      await sendQuotePdfViaWhatsApp(
        quote,
        (data ?? []) as QuoteItem[],
        contactId,
        t('page.sendCaption', { number: quote.number }),
      );
      toast.success(t('page.sent'));
      if (quote.status === 'draft') await changeStatus(quote, 'sent');
      setSendTarget(null);
    } catch (err) {
      console.error('Quote send failed:', err);
      toast.error(err instanceof Error && err.message !== 'send failed' ? err.message : t('page.sendFailed'));
    } finally {
      setSending(false);
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

      <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Input
          value={fNumber}
          onChange={(e) => setFNumber(e.target.value)}
          inputMode="numeric"
          placeholder={t('page.filterNumber')}
          className="bg-muted text-foreground"
        />
        <Input
          value={fCnpj}
          onChange={(e) => setFCnpj(e.target.value)}
          placeholder={t('page.filterCnpj')}
          className="bg-muted text-foreground"
        />
        <Input
          value={fContact}
          onChange={(e) => setFContact(e.target.value)}
          placeholder={t('page.filterContact')}
          className="bg-muted text-foreground"
        />
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value as '' | QuoteStatus)}
          className="h-9 w-full rounded-md border border-border bg-muted px-2 text-sm text-foreground"
        >
          <option value="">{t('page.filterStatusAll')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
        <label className="space-y-0.5 text-[11px] text-muted-foreground">
          {t('page.filterFrom')}
          <Input
            type="date"
            value={fFrom}
            onChange={(e) => setFFrom(e.target.value)}
            className="bg-muted text-foreground"
          />
        </label>
        <label className="space-y-0.5 text-[11px] text-muted-foreground">
          {t('page.filterTo')}
          <Input
            type="date"
            value={fTo}
            onChange={(e) => setFTo(e.target.value)}
            className="bg-muted text-foreground"
          />
        </label>
        <Button type="button" variant="outline" onClick={clearFilters} disabled={!hasFilters}>
          {t('page.filterClear')}
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
              <TableHead className="w-40" />
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
                        onClick={() =>
                          setReceivableDraft({
                            contact_id: q.contact_id,
                            company_id: q.company_id,
                            deal_id: q.deal_id,
                            quote_id: q.id,
                            description: t('page.receivableDescription', { number: q.number }),
                            amount: Number(q.total),
                          })
                        }
                        disabled={!canEdit}
                        aria-label={t('page.createReceivable')}
                        title={t('page.createReceivable')}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      >
                        <Wallet className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => askEmail(q)}
                        disabled={!canEdit || busyId === q.id}
                        aria-label={t('page.sendEmail')}
                        title={t('page.sendEmail')}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      >
                        <Mail className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => askSend(q)}
                        disabled={!canEdit}
                        aria-label={t('page.sendWhatsapp')}
                        title={t('page.sendWhatsapp')}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      >
                        <Send className="h-4 w-4" />
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

      <ReceivableDialog
        open={!!receivableDraft}
        onOpenChange={(v) => !v && setReceivableDraft(null)}
        prefill={receivableDraft ?? undefined}
        onSaved={() => toast.success(t('page.receivableCreated'))}
      />
      <NewEmailDialog
        open={!!emailDraft}
        onOpenChange={(v) => !v && setEmailDraft(null)}
        initial={emailDraft?.initial}
        contactId={emailDraft?.contactId ?? null}
      />
      <Dialog open={!!sendTarget} onOpenChange={(v) => !sending && !v && setSendTarget(null)}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('page.sendTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('page.sendDescription', {
                number: sendTarget?.quote.number ?? 0,
                name: sendTarget?.name ?? '',
                phone: sendTarget?.phone ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={sending} onClick={() => setSendTarget(null)}>
              {t('form.cancel')}
            </Button>
            <Button disabled={sending} onClick={confirmSend} className="gap-1.5">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t('page.sendConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
