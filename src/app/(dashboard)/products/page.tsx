'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Loader2, Package, Pencil, Plus, Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { formatBRL, parseMoney } from '@/lib/quotes/format';
import type { Product } from '@/types';
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
}

const EMPTY: FormState = {
  description: '',
  kind: 'product',
  ncm: '',
  unit_price: '',
  unit: 'un',
  active: true,
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

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
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
    });
    setFormOpen(true);
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
    setSaving(true);
    const row = {
      description,
      kind: form.kind,
      ncm: form.ncm.trim() || null,
      unit_price: price,
      unit: form.unit.trim() || 'un',
      active: form.active,
    };
    const { error } = editing
      ? await supabase.from('products').update(row).eq('id', editing.id)
      : await supabase
          .from('products')
          .insert({ ...row, account_id: accountId, user_id: user?.id ?? null });
    setSaving(false);
    if (error) {
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
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
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
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  <Package className="mx-auto mb-2 h-6 w-6" />
                  {t('empty')}
                </TableCell>
              </TableRow>
            ) : (
              products.map((p) => (
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

      <Dialog open={formOpen} onOpenChange={(v) => !saving && setFormOpen(v)}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
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
