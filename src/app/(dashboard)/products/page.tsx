'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Loader2, Package, Pencil, Plus, Search, Trash2, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { formatBRL, formatQuantity, formatShortDate, parseMoney } from '@/lib/quotes/format';
import type { Product, ProductSupplier } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface FormState {
  description: string;
  kind: 'product' | 'service';
  ncm: string;
  unit_price: string;
  unit: string;
  active: boolean;
  purchase_price: string;
  stock_qty: string;
  min_stock: string;
  cest: string;
  ean: string;
  ean_tributado: string;
  origin: string;
}

interface SupplierDraft {
  key: number;
  legal_name: string;
  trade_name: string;
  last_price: string;
  last_date: string;
  doc_number: string;
  origin: string;
}

const ORIGINS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-border bg-muted px-2 text-sm text-foreground';

let supplierKey = 0;
const blankSupplier = (): SupplierDraft => ({
  key: ++supplierKey,
  legal_name: '',
  trade_name: '',
  last_price: '',
  last_date: '',
  doc_number: '',
  origin: '',
});

const toInput = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : String(n).replace('.', ',');

/** Lower-case and strip accents so "extintor" finds "Extíntor". */
const normalize = (v: string) =>
  v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const EMPTY: FormState = {
  description: '',
  kind: 'product',
  ncm: '',
  unit_price: '',
  unit: 'un',
  active: true,
  purchase_price: '',
  stock_qty: '0',
  min_stock: '0',
  cest: '',
  ean: '',
  ean_tributado: '',
  origin: '',
};

export default function ProductsPage() {
  const t = useTranslations('Products');
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const canEdit = useCan('send-messages');

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');
  const [suppliers, setSuppliers] = useState<SupplierDraft[]>([]);
  const [newSupplier, setNewSupplier] = useState<SupplierDraft>(blankSupplier());

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('description');
    if (error) toast.error(t('loadFailed'));
    setProducts((data ?? []) as Product[]);
    setLoading(false);
  }, [supabase, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = normalize(search.trim());
    if (!term) return products;
    const digits = term.replace(/\D/g, '');
    return products.filter(
      (p) =>
        normalize(p.description).includes(term) ||
        (digits && (p.ncm ?? '').includes(digits)) ||
        (digits && (p.ean ?? '').includes(digits)),
    );
  }, [products, search]);

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setSuppliers([]);
    setNewSupplier(blankSupplier());
    setFormOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      description: p.description,
      kind: p.kind,
      ncm: p.ncm ?? '',
      unit_price: String(p.unit_price).replace('.', ','),
      unit: p.unit,
      active: p.active,
      purchase_price: toInput(p.purchase_price),
      stock_qty: toInput(p.stock_qty),
      min_stock: toInput(p.min_stock),
      cest: p.cest ?? '',
      ean: p.ean ?? '',
      ean_tributado: p.ean_tributado ?? '',
      origin: p.origin === null || p.origin === undefined ? '' : String(p.origin),
    });
    setSuppliers([]);
    setNewSupplier(blankSupplier());
    setFormOpen(true);
    supabase
      .from('product_suppliers')
      .select('*')
      .eq('product_id', p.id)
      .order('created_at')
      .then(({ data }) => {
        setSuppliers(
          ((data ?? []) as ProductSupplier[]).map((r) => ({
            key: ++supplierKey,
            legal_name: r.legal_name,
            trade_name: r.trade_name ?? '',
            last_price: toInput(r.last_price),
            last_date: r.last_date ?? '',
            doc_number: r.doc_number ?? '',
            origin: r.origin ?? '',
          })),
        );
      });
  }

  function addSupplier() {
    const legal = newSupplier.legal_name.trim();
    if (!legal) {
      toast.error(t('form.supplierNameRequired'));
      return;
    }
    if (newSupplier.last_price.trim() && !Number.isFinite(parseMoney(newSupplier.last_price))) {
      toast.error(t('priceInvalid'));
      return;
    }
    setSuppliers((prev) => [...prev, { ...newSupplier, legal_name: legal }]);
    setNewSupplier(blankSupplier());
  }

  async function save() {
    const description = form.description.trim();
    if (!description) {
      toast.error(t('descriptionRequired'));
      return;
    }
    const price = form.unit_price.trim() ? parseMoney(form.unit_price) : 0;
    if (!Number.isFinite(price) || price < 0) {
      toast.error(t('priceInvalid'));
      return;
    }
    if (!accountId) return;

    const isProduct = form.kind === 'product';
    const optional = (v: string) => (v.trim() ? parseMoney(v) : null);
    const purchase = isProduct ? optional(form.purchase_price) : null;
    const stock = isProduct ? (form.stock_qty.trim() ? parseMoney(form.stock_qty) : 0) : 0;
    const minStock = isProduct ? (form.min_stock.trim() ? parseMoney(form.min_stock) : 0) : 0;
    if (
      (purchase !== null && (!Number.isFinite(purchase) || purchase < 0)) ||
      !Number.isFinite(stock) ||
      !Number.isFinite(minStock) ||
      minStock < 0
    ) {
      toast.error(t('numberInvalid'));
      return;
    }
    const supplierRows = [];
    for (const sp of isProduct ? suppliers : []) {
      const lp = sp.last_price.trim() ? parseMoney(sp.last_price) : null;
      if (lp !== null && (!Number.isFinite(lp) || lp < 0)) {
        toast.error(t('priceInvalid'));
        return;
      }
      supplierRows.push({
        legal_name: sp.legal_name.trim(),
        trade_name: sp.trade_name.trim() || null,
        last_price: lp,
        last_date: sp.last_date || null,
        doc_number: sp.doc_number.trim() || null,
        origin: sp.origin.trim() || null,
      });
    }

    setSaving(true);
    const row = {
      description,
      kind: form.kind,
      ncm: form.ncm.trim() || null,
      unit_price: price,
      unit: form.unit.trim() || 'un',
      active: form.active,
      purchase_price: purchase,
      stock_qty: stock,
      min_stock: minStock,
      cest: isProduct ? form.cest.trim() || null : null,
      ean: isProduct ? form.ean.trim() || null : null,
      ean_tributado: isProduct ? form.ean_tributado.trim() || null : null,
      origin: isProduct && form.origin !== '' ? Number(form.origin) : null,
    };
    const saved = editing
      ? await supabase.from('products').update(row).eq('id', editing.id).select('id').single()
      : await supabase
          .from('products')
          .insert({ ...row, account_id: accountId, user_id: user?.id ?? null })
          .select('id')
          .single();
    if (saved.error || !saved.data) {
      setSaving(false);
      toast.error(t('saveFailed'));
      return;
    }
    const productId = (saved.data as { id: string }).id;

    // Replace the supplier list wholesale: simplest way to keep removals right.
    const del = await supabase.from('product_suppliers').delete().eq('product_id', productId);
    const ins =
      !del.error && supplierRows.length
        ? await supabase
            .from('product_suppliers')
            .insert(supplierRows.map((r) => ({ ...r, product_id: productId, account_id: accountId })))
        : null;
    setSaving(false);
    if (del.error || ins?.error) {
      toast.error(t('saveFailed'));
      return;
    }
    setFormOpen(false);
    load();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('products').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (error) {
      toast.error(t('deleteFailed'));
      return;
    }
    setDeleteTarget(null);
    toast.success(t('deleted'));
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
            placeholder={t('searchPlaceholder')}
            className="bg-muted pl-8 text-foreground"
          />
        </div>
        <Button onClick={openNew} disabled={!canEdit} className="gap-1.5">
          <Plus className="h-4 w-4" />
          {t('newProduct')}
        </Button>
      </div>

      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colDescription')}</TableHead>
              <TableHead>{t('colKind')}</TableHead>
              <TableHead>{t('colNcm')}</TableHead>
              <TableHead className="text-right">{t('colPrice')}</TableHead>
              <TableHead className="text-right">{t('colStock')}</TableHead>
              <TableHead className="w-24" />
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
                  <Package className="mx-auto mb-2 h-6 w-6" />
                  {products.length === 0 ? t('empty') : t('noResults')}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <TableRow key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <TableCell className="font-medium text-foreground">
                    {p.description}
                    {!p.active && (
                      <span className="ml-2 text-xs text-muted-foreground">({t('inactive')})</span>
                    )}
                  </TableCell>
                  <TableCell>{p.kind === 'product' ? t('kindProduct') : t('kindService')}</TableCell>
                  <TableCell>{p.ncm ?? ''}</TableCell>
                  <TableCell className="text-right">{formatBRL(p.unit_price)}</TableCell>
                  <TableCell
                    className={`text-right ${
                      p.kind === 'product' && p.min_stock > 0 && p.stock_qty <= p.min_stock
                        ? 'font-medium text-red-400'
                        : ''
                    }`}
                    title={
                      p.kind === 'product' && p.min_stock > 0
                        ? t('minStockHint', { min: formatQuantity(p.min_stock) })
                        : undefined
                    }
                  >
                    {p.kind === 'product' ? formatQuantity(p.stock_qty) : ''}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        disabled={!canEdit}
                        aria-label={t('edit')}
                        title={t('edit')}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(p)}
                        disabled={!canEdit}
                        aria-label={t('delete')}
                        title={t('delete')}
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

      <Dialog open={formOpen} onOpenChange={(v) => !saving && setFormOpen(v)} disablePointerDismissal>
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-popover border-border text-popover-foreground sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editing ? t('form.titleEdit') : t('form.titleNew')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('form.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t('form.descriptionLabel')}</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={t('form.descriptionPlaceholder')}
                className="bg-muted text-foreground"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('form.kind')}</Label>
                <select
                  value={form.kind}
                  onChange={(e) =>
                    setForm({ ...form, kind: e.target.value as FormState['kind'] })
                  }
                  className="h-9 w-full rounded-md border border-border bg-muted px-2 text-sm text-foreground"
                >
                  <option value="product">{t('kindProduct')}</option>
                  <option value="service">{t('kindService')}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('form.ncm')}</Label>
                <Input
                  value={form.ncm}
                  onChange={(e) => setForm({ ...form, ncm: e.target.value })}
                  placeholder="84241000"
                  className="bg-muted text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('form.unitPrice')}</Label>
                <Input
                  value={form.unit_price}
                  onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
                  placeholder="260,00"
                  inputMode="decimal"
                  className="bg-muted text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('form.unit')}</Label>
                <Input
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  className="bg-muted text-foreground"
                />
              </div>
            </div>
            {form.kind === 'product' && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>{t('form.purchasePrice')}</Label>
                    <Input
                      value={form.purchase_price}
                      onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="bg-muted text-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('form.stockQty')}</Label>
                    <Input
                      value={form.stock_qty}
                      onChange={(e) => setForm({ ...form, stock_qty: e.target.value })}
                      inputMode="decimal"
                      className="bg-muted text-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('form.minStock')}</Label>
                    <Input
                      value={form.min_stock}
                      onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
                      inputMode="decimal"
                      className="bg-muted text-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('form.cest')}</Label>
                    <Input
                      value={form.cest}
                      onChange={(e) => setForm({ ...form, cest: e.target.value })}
                      className="bg-muted text-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('form.ean')}</Label>
                    <Input
                      value={form.ean}
                      onChange={(e) => setForm({ ...form, ean: e.target.value.replace(/\D/g, '') })}
                      inputMode="numeric"
                      maxLength={14}
                      className="bg-muted text-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('form.eanTributado')}</Label>
                    <Input
                      value={form.ean_tributado}
                      onChange={(e) => setForm({ ...form, ean_tributado: e.target.value.replace(/\D/g, '') })}
                      inputMode="numeric"
                      maxLength={14}
                      className="bg-muted text-foreground"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('form.origin')}</Label>
                  <select
                    value={form.origin}
                    onChange={(e) => setForm({ ...form, origin: e.target.value })}
                    className={SELECT_CLASS}
                  >
                    <option value="">{t('form.originNone')}</option>
                    {ORIGINS.map((o) => (
                      <option key={o} value={o}>
                        {o} - {t(`origins.o${o}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <section className="space-y-2 rounded-lg border border-border p-3">
                  <h3 className="text-sm font-semibold text-foreground">{t('form.suppliers')}</h3>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <Input
                      value={newSupplier.legal_name}
                      onChange={(e) => setNewSupplier({ ...newSupplier, legal_name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addSupplier();
                        }
                      }}
                      placeholder={t('form.supplierLegalName')}
                      className="bg-muted text-foreground"
                    />
                    <Button type="button" onClick={addSupplier} className="gap-1.5">
                      <Plus className="h-4 w-4" />
                      {t('form.addSupplier')}
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Input
                      value={newSupplier.trade_name}
                      onChange={(e) => setNewSupplier({ ...newSupplier, trade_name: e.target.value })}
                      placeholder={t('form.supplierTradeName')}
                      className="bg-muted text-foreground"
                    />
                    <Input
                      value={newSupplier.last_price}
                      onChange={(e) => setNewSupplier({ ...newSupplier, last_price: e.target.value })}
                      inputMode="decimal"
                      placeholder={t('form.supplierLastPrice')}
                      className="bg-muted text-foreground"
                    />
                    <Input
                      type="date"
                      value={newSupplier.last_date}
                      onChange={(e) => setNewSupplier({ ...newSupplier, last_date: e.target.value })}
                      title={t('form.supplierLastDate')}
                      className="bg-muted text-foreground"
                    />
                    <Input
                      value={newSupplier.doc_number}
                      onChange={(e) => setNewSupplier({ ...newSupplier, doc_number: e.target.value })}
                      placeholder={t('form.supplierNumber')}
                      className="bg-muted text-foreground"
                    />
                  </div>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('form.supplierLegalName')}</TableHead>
                          <TableHead>{t('form.supplierTradeName')}</TableHead>
                          <TableHead className="text-right">{t('form.supplierLastPrice')}</TableHead>
                          <TableHead>{t('form.supplierLastDate')}</TableHead>
                          <TableHead>{t('form.supplierNumber')}</TableHead>
                          <TableHead className="w-8" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {suppliers.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="py-4 text-center text-xs text-muted-foreground">
                              {t('form.noSuppliers')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          suppliers.map((sp) => (
                            <TableRow key={sp.key}>
                              <TableCell className="font-medium text-foreground">{sp.legal_name}</TableCell>
                              <TableCell>{sp.trade_name}</TableCell>
                              <TableCell className="text-right">
                                {sp.last_price.trim() ? formatBRL(parseMoney(sp.last_price)) : ''}
                              </TableCell>
                              <TableCell>{sp.last_date ? formatShortDate(sp.last_date) : ''}</TableCell>
                              <TableCell>{sp.doc_number}</TableCell>
                              <TableCell>
                                <button
                                  type="button"
                                  onClick={() => setSuppliers((prev) => prev.filter((x) => x.key !== sp.key))}
                                  aria-label={t('form.removeSupplier')}
                                  title={t('form.removeSupplier')}
                                  className="rounded-md p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              </>
            )}
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              {t('form.active')}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setFormOpen(false)}>
              {t('form.cancel')}
            </Button>
            <Button disabled={saving} onClick={save}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t('form.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(v) => !deleting && !v && setDeleteTarget(null)}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('deleteTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteDescription', { name: deleteTarget?.description ?? '' })}
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
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
