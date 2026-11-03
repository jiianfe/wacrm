"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { FileDown, Loader2, Plus, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCep } from "@/lib/br/documents";
import { QUOTE_DEFAULTS } from "@/lib/quotes/company";
import { attachQuotePdfToDeal } from "@/lib/quotes/download";
import {
  addDays,
  formatBRL,
  formatPhoneBR,
  formatQuantity,
  lineTotal,
  nextQuoteNumber,
  parseMoney,
  quoteTotal,
} from "@/lib/quotes/format";
import { localDateString } from "@/lib/deal-tasks";
import type { Product, Quote, QuoteItem } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CompanyRow {
  id: string;
  legal_name: string | null;
  trade_name: string | null;
  cnpj: string | null;
  address_street: string | null;
  address_number: string | null;
  address_district: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}

interface ContactOption {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface ItemDraft {
  key: number;
  quantity: string;
  description: string;
  ncm: string;
  unit_price: string;
  /** Product or service: the catalog list only offers entries of this kind. */
  kind: "product" | "service";
  /** Catalog product this line came from; "" for a free-text line. */
  productId: string;
  /** Take the quantity off the product's stock; the line then comes only from the catalog. */
  deduct: boolean;
}

/** What the AI (or any caller) already knows when starting a new quote. */
export interface QuotePrefill {
  contactId?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  items?: { productId: string | null; description: string; quantity: number }[];
}

interface DealOption {
  id: string;
  title: string;
}

interface QuoteFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quote to edit; null starts a new one. */
  quote: Quote | null;
  /** Starting data for a NEW quote (ignored when editing). */
  prefill?: QuotePrefill | null;
  /** Called after saving; `download` is true for "Save and download PDF". */
  onSaved: (quote: Quote, items: QuoteItem[], download: boolean) => void;
}

let itemKey = 0;
const blankItem = (): ItemDraft => ({
  key: ++itemKey,
  quantity: "1",
  description: "",
  ncm: "",
  unit_price: "",
  kind: "product",
  productId: "",
  deduct: false,
});

/** Lower-case and strip accents so "joao" finds "João". */
const normalize = (v: string) =>
  v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-border bg-muted px-2 text-sm text-foreground";
const INPUT_CLASS = "bg-muted text-foreground";

export function QuoteForm({ open, onOpenChange, quote, prefill, onSaved }: QuoteFormProps) {
  const t = useTranslations("Quotes.form");
  const supabase = createClient();
  const { accountId, user, profile } = useAuth();

  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [dealId, setDealId] = useState("");
  const [saving, setSaving] = useState(false);

  const [number, setNumber] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyFocused, setCompanyFocused] = useState(false);
  const [contactId, setContactId] = useState("");
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [document, setDocument] = useState("");
  const [address, setAddress] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [paymentDue, setPaymentDue] = useState("");
  const [notes, setNotes] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [sellerPhone, setSellerPhone] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([blankItem()]);

   
  // Load the lists and (re)initialise every field whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setContacts([]);

    (async () => {
      const [companiesRes, productsRes, numbersRes, itemsRes, dealsRes] = await Promise.all([
        supabase
          .from("companies")
          .select(
            "id, legal_name, trade_name, cnpj, address_street, address_number, address_district, address_city, address_state, address_zip",
          )
          .order("trade_name"),
        supabase.from("products").select("*").eq("active", true).order("description"),
        quote
          ? Promise.resolve({ data: [] as { number: number }[] })
          : supabase.from("quotes").select("number").order("number", { ascending: false }).limit(1),
        quote
          ? supabase.from("quote_items").select("*").eq("quote_id", quote.id).order("position")
          : Promise.resolve({ data: [] as QuoteItem[] }),
        supabase.from("deals").select("id, title").order("created_at", { ascending: false }).limit(300),
      ]);
      if (cancelled) return;
      const companyList = (companiesRes.data ?? []) as CompanyRow[];
      const productList = (productsRes.data ?? []) as Product[];
      setCompanies(companyList);
      setProducts(productList);
      setDeals((dealsRes.data ?? []) as DealOption[]);

      if (quote) {
        setNumber(String(quote.number));
        setCompanyId(quote.company_id ?? "");
        setCompanyQuery(quote.client_trade_name || quote.client_legal_name || "");
        setDealId(quote.deal_id ?? "");
        setContactId(quote.contact_id ?? "");
        setLegalName(quote.client_legal_name ?? "");
        setTradeName(quote.client_trade_name ?? "");
        setDocument(quote.client_document ?? "");
        setAddress(quote.client_address ?? "");
        setAddressNumber(quote.client_address_number ?? "");
        setDistrict(quote.client_district ?? "");
        setCity(quote.client_city ?? "");
        setZip(quote.client_zip ?? "");
        setContactName(quote.contact_name ?? "");
        setContactEmail(quote.contact_email ?? "");
        setContactPhone(quote.contact_phone ?? "");
        setIssueDate(quote.issue_date);
        setValidUntil(quote.valid_until ?? "");
        setDeliveryTime(quote.delivery_time ?? "");
        setPaymentTerms(quote.payment_terms ?? "");
        setPaymentDue(quote.payment_due ?? "");
        setNotes(quote.notes ?? "");
        setSellerName(quote.seller_name ?? "");
        setSellerPhone(quote.seller_phone ?? "");
        const rows = (itemsRes.data ?? []) as QuoteItem[];
        setItems(
          rows.length
            ? rows.map((r) => ({
                key: ++itemKey,
                quantity: String(r.quantity).replace(".", ","),
                description: r.description,
                ncm: r.ncm ?? "",
                unit_price: String(r.unit_price).replace(".", ","),
                kind: productList.find((x) => x.id === r.product_id)?.kind ?? "product",
                productId: r.product_id ?? "",
                deduct: r.deduct_stock,
              }))
            : [blankItem()],
        );
      } else {
        const today = localDateString();
        const highest = ((numbersRes.data ?? []) as { number: number }[]).map((r) => r.number);
        setNumber(String(nextQuoteNumber(highest, QUOTE_DEFAULTS.firstNumber)));
        setCompanyId("");
        setCompanyQuery("");
        setContactId("");
        setLegalName("");
        setTradeName("");
        setDocument("");
        setAddress("");
        setAddressNumber("");
        setDistrict("");
        setCity("");
        setZip("");
        setContactName("");
        setContactEmail("");
        setContactPhone("");
        setIssueDate(today);
        setValidUntil(addDays(today, QUOTE_DEFAULTS.validityDays));
        setDeliveryTime(QUOTE_DEFAULTS.deliveryTime);
        setPaymentTerms(QUOTE_DEFAULTS.paymentTerms);
        setPaymentDue("");
        setNotes(prefill?.notes ?? "");
        setSellerName(profile?.full_name ?? "");
        setSellerPhone(QUOTE_DEFAULTS.sellerPhone);
        setDealId("");

        if (prefill) {
          setContactId(prefill.contactId ?? "");
          setContactName(prefill.contactName ?? "");
          setContactEmail(prefill.contactEmail ?? "");
          setContactPhone(formatPhoneBR(prefill.contactPhone));
          const drafts = (prefill.items ?? []).map((pi): ItemDraft => {
            const prod = productList.find((x) => x.id === pi.productId);
            return {
              key: ++itemKey,
              quantity: String(pi.quantity).replace(".", ","),
              description: prod ? prod.description : pi.description,
              ncm: prod?.ncm ?? "",
              unit_price: prod ? String(prod.unit_price).replace(".", ",") : "",
              kind: prod?.kind ?? "product",
              productId: prod?.id ?? "",
              deduct: false,
            };
          });
          setItems(drafts.length ? drafts : [blankItem()]);

          // The contact's company, when there is one, fills the client block.
          if (prefill.contactId) {
            const { data: links } = await supabase
              .from("company_contacts")
              .select("company_id")
              .eq("contact_id", prefill.contactId)
              .limit(1);
            const cid = (links?.[0] as { company_id: string } | undefined)?.company_id;
            const company = companyList.find((x) => x.id === cid);
            if (!cancelled && company) {
              setCompanyId(company.id);
              fillCompany(company);
            }
          }
        } else {
          setItems([blankItem()]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // `supabase`/`profile` are stable enough for a once-per-open initialisation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quote]);
   

  async function loadContacts(forCompanyId: string) {
    const { data } = await supabase
      .from("company_contacts")
      .select("contact:contacts(id, name, email, phone)")
      .eq("company_id", forCompanyId);
    const rows = ((data ?? []) as unknown as { contact: ContactOption | null }[])
      .map((r) => r.contact)
      .filter((c): c is ContactOption => !!c);
    setContacts(rows);
  }

  // Keep the contact list in step with the chosen company (also when editing).
  useEffect(() => {
    if (!open || !companyId) return;
     
    loadContacts(companyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companyId]);

  // Companies whose name (or CNPJ) is closest to what was typed; nothing until typing.
  const suggestions = useMemo(() => {
    const term = normalize(companyQuery.trim());
    if (!term) return [];
    const digits = term.replace(/\D/g, "");
    return companies
      .map((c) => {
        const names = [c.trade_name, c.legal_name].filter(Boolean).map((n) => normalize(n as string));
        let score = 99;
        for (const n of names) {
          if (n.startsWith(term)) score = Math.min(score, 0);
          else if (n.split(/\s+/).some((w) => w.startsWith(term))) score = Math.min(score, 1);
          else if (n.includes(term)) score = Math.min(score, 2);
        }
        if (digits.length >= 3 && (c.cnpj ?? "").replace(/\D/g, "").includes(digits)) score = Math.min(score, 2);
        return { c, score };
      })
      .filter((x) => x.score < 99)
      .sort((a, b) => a.score - b.score || (a.c.trade_name || a.c.legal_name || "").localeCompare(b.c.trade_name || b.c.legal_name || ""))
      .slice(0, 8)
      .map((x) => x.c);
  }, [companies, companyQuery]);

  function pickCompany(id: string) {
    setCompanyId(id);
    setContactId("");
    if (!id) {
      setContacts([]);
      return;
    }
    const c = companies.find((x) => x.id === id);
    if (c) fillCompany(c);
  }

  function fillCompany(c: CompanyRow) {
    setCompanyQuery(c.trade_name || c.legal_name || "");
    setLegalName(c.legal_name ?? "");
    setTradeName(c.trade_name ?? "");
    setDocument(c.cnpj ?? "");
    setAddress(c.address_street ?? "");
    setAddressNumber(c.address_number ?? "");
    setDistrict(c.address_district ?? "");
    setCity([c.address_city, c.address_state].filter(Boolean).join(" - "));
    setZip(c.address_zip ? formatCep(c.address_zip) : "");
  }

  function pickContact(id: string) {
    setContactId(id);
    const c = contacts.find((x) => x.id === id);
    if (!c) return;
    setContactName(c.name ?? "");
    setContactEmail(c.email ?? "");
    setContactPhone(formatPhoneBR(c.phone));
  }

  function updateItem(key: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function pickProduct(key: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    updateItem(key, {
      kind: p.kind,
      productId: p.id,
      description: p.description,
      ncm: p.ncm ?? "",
      unit_price: String(p.unit_price).replace(".", ","),
      // A service has no stock to take from.
      ...(p.kind === "product" ? {} : { deduct: false }),
    });
  }

  /** Changing between product and service drops a catalog pick of the other kind. */
  function changeKind(key: number, kind: "product" | "service") {
    const it = items.find((x) => x.key === key);
    const keep = products.find((x) => x.id === it?.productId)?.kind === kind;
    updateItem(key, keep ? { kind } : { kind, productId: "", deduct: false });
  }

  function clearProduct(key: number) {
    updateItem(key, { productId: "", deduct: false });
  }

  function toggleDeduct(key: number, on: boolean) {
    const it = items.find((x) => x.key === key);
    const p = products.find((x) => x.id === it?.productId);
    if (!p) return;
    // The line must match the catalog item when it comes off the stock.
    updateItem(key, on ? { deduct: true, description: p.description } : { deduct: false });
  }

  const parsed = items.map((it) => ({
    quantity: parseMoney(it.quantity),
    unit_price: it.unit_price.trim() ? parseMoney(it.unit_price) : 0,
  }));
  const total = quoteTotal(
    parsed.filter((p) => Number.isFinite(p.quantity) && Number.isFinite(p.unit_price)),
  );

  async function save(download: boolean) {
    const num = Number(number);
    if (!Number.isInteger(num) || num <= 0) {
      toast.error(t("numberInvalid"));
      return;
    }
    if (!legalName.trim() && !tradeName.trim() && !contactName.trim()) {
      toast.error(t("needClient"));
      return;
    }
    const filled = items
      .map((it, i) => ({ it, p: parsed[i] }))
      .filter(({ it }) => it.description.trim());
    if (filled.length === 0) {
      toast.error(t("needItems"));
      return;
    }
    if (filled.some(({ p }) => !(p.quantity > 0) || !Number.isFinite(p.unit_price) || p.unit_price < 0)) {
      toast.error(t("invalidItem"));
      return;
    }
    if (!accountId) return;

    setSaving(true);
    const row = {
      number: num,
      company_id: companyId || null,
      contact_id: contactId || null,
      deal_id: dealId || null,
      client_legal_name: legalName.trim() || null,
      client_trade_name: tradeName.trim() || null,
      client_document: document.trim() || null,
      client_address: address.trim() || null,
      client_address_number: addressNumber.trim() || null,
      client_district: district.trim() || null,
      client_city: city.trim() || null,
      client_zip: zip.trim() || null,
      contact_name: contactName.trim() || null,
      contact_email: contactEmail.trim() || null,
      contact_phone: contactPhone.trim() || null,
      seller_name: sellerName.trim() || null,
      seller_phone: sellerPhone.trim() || null,
      issue_date: issueDate || localDateString(),
      valid_until: validUntil || null,
      delivery_time: deliveryTime.trim() || null,
      payment_terms: paymentTerms.trim() || null,
      payment_due: paymentDue.trim() || null,
      notes: notes.trim() || null,
      total: quoteTotal(filled.map(({ p }) => p)),
    };

    const saved = quote
      ? await supabase.from("quotes").update(row).eq("id", quote.id).select("*").single()
      : await supabase
          .from("quotes")
          .insert({ ...row, account_id: accountId, user_id: user?.id ?? null })
          .select("*")
          .single();
    if (saved.error || !saved.data) {
      setSaving(false);
      toast.error(saved.error?.code === "23505" ? t("numberTaken") : t("saveFailed"));
      return;
    }
    const savedQuote = saved.data as Quote;

    // Replace the lines wholesale: simplest way to keep order and removals right.
    if (quote) {
      const del = await supabase.from("quote_items").delete().eq("quote_id", savedQuote.id);
      if (del.error) {
        setSaving(false);
        toast.error(t("saveFailed"));
        return;
      }
    }
    const lines = filled.map(({ it, p }, position) => ({
      quote_id: savedQuote.id,
      account_id: accountId,
      position,
      quantity: p.quantity,
      description: it.description.trim(),
      ncm: it.ncm.trim() || null,
      unit_price: p.unit_price,
      product_id: it.productId || null,
      deduct_stock: it.deduct && !!it.productId,
    }));
    const ins = await supabase.from("quote_items").insert(lines).select("*");
    setSaving(false);
    if (ins.error) {
      toast.error(t("saveFailed"));
      return;
    }
    const savedItems = ((ins.data ?? []) as QuoteItem[]).sort((a, b) => a.position - b.position);
    if (savedQuote.deal_id) {
      try {
        await attachQuotePdfToDeal(savedQuote, savedItems, savedQuote.deal_id, {
          userId: user?.id ?? null,
          name: profile?.full_name || profile?.email || null,
        });
        toast.success(t("attachedToDeal"));
      } catch (err) {
        console.error("Attach quote PDF failed:", err);
        toast.error(t("attachFailed"));
      }
    }
    onOpenChange(false);
    onSaved(savedQuote, savedItems, download);
  }

  const field = (label: string, node: React.ReactNode, className = "") => (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {node}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)} disablePointerDismissal>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-popover border-border text-popover-foreground sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {quote ? t("titleEdit", { number: quote.number }) : t("titleNew")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {field(
              t("number"),
              <Input
                value={number}
                onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                className={INPUT_CLASS}
              />,
            )}
            {field(
              t("issueDate"),
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={INPUT_CLASS} />,
            )}
            {field(
              t("validUntil"),
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={INPUT_CLASS} />,
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t("client")}</h3>
            {field(
              t("company"),
              <div className="relative">
                <Input
                  value={companyQuery}
                  onChange={(e) => {
                    setCompanyQuery(e.target.value);
                    if (!e.target.value.trim() && companyId) pickCompany("");
                  }}
                  onFocus={() => setCompanyFocused(true)}
                  onBlur={() => setCompanyFocused(false)}
                  placeholder={t("companySearch")}
                  autoComplete="off"
                  className={INPUT_CLASS}
                />
                {companyFocused && companyQuery.trim() && (
                  <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg">
                    {suggestions.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-muted-foreground">{t("companyNoMatch")}</li>
                    ) : (
                      suggestions.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            // mouseDown (not click) so the input keeps focus until the pick lands.
                            onMouseDown={(e) => {
                              e.preventDefault();
                              pickCompany(c.id);
                              setCompanyFocused(false);
                            }}
                            className="flex w-full flex-col px-3 py-1.5 text-left text-sm hover:bg-muted"
                          >
                            <span className="text-foreground">{c.trade_name || c.legal_name}</span>
                            {c.trade_name && c.legal_name && c.trade_name !== c.legal_name && (
                              <span className="text-xs text-muted-foreground">{c.legal_name}</span>
                            )}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>,
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {field(t("legalName"), <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={INPUT_CLASS} />)}
              {field(t("tradeName"), <Input value={tradeName} onChange={(e) => setTradeName(e.target.value)} className={INPUT_CLASS} />)}
              {field(t("document"), <Input value={document} onChange={(e) => setDocument(e.target.value)} className={INPUT_CLASS} />)}
              {field(t("address"), <Input value={address} onChange={(e) => setAddress(e.target.value)} className={INPUT_CLASS} />)}
              {field(t("addressNumber"), <Input value={addressNumber} onChange={(e) => setAddressNumber(e.target.value)} className={INPUT_CLASS} />)}
              {field(t("district"), <Input value={district} onChange={(e) => setDistrict(e.target.value)} className={INPUT_CLASS} />)}
              {field(t("city"), <Input value={city} onChange={(e) => setCity(e.target.value)} className={INPUT_CLASS} />)}
              {field(t("zip"), <Input value={zip} onChange={(e) => setZip(e.target.value)} className={INPUT_CLASS} />)}
            </div>
            {field(
              t("deal"),
              <select value={dealId} onChange={(e) => setDealId(e.target.value)} className={SELECT_CLASS}>
                <option value="">{t("noDeal")}</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>,
            )}
            {contacts.length > 0 &&
              field(
                t("pickContact"),
                <select value={contactId} onChange={(e) => pickContact(e.target.value)} className={SELECT_CLASS}>
                  <option value="">{t("typeContact")}</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.phone}
                    </option>
                  ))}
                </select>,
              )}
            <div className="grid gap-3 sm:grid-cols-3">
              {field(t("contactName"), <Input value={contactName} onChange={(e) => setContactName(e.target.value)} className={INPUT_CLASS} />)}
              {field(t("contactEmail"), <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={INPUT_CLASS} />)}
              {field(t("contactPhone"), <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={INPUT_CLASS} />)}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t("items")}</h3>
            <div className="space-y-3">
              {items.map((it, i) => {
                const p = parsed[i];
                const lt =
                  Number.isFinite(p.quantity) && Number.isFinite(p.unit_price)
                    ? lineTotal({ quantity: p.quantity, unit_price: p.unit_price })
                    : 0;
                return (
                  <div key={it.key} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="grid gap-2 sm:grid-cols-[9rem_1fr_auto]">
                      <select
                        value={it.kind}
                        onChange={(e) => changeKind(it.key, e.target.value as "product" | "service")}
                        aria-label={t("itemKind")}
                        className={SELECT_CLASS}
                      >
                        <option value="product">{t("kindProduct")}</option>
                        <option value="service">{t("kindService")}</option>
                      </select>
                      <select
                        value={it.productId}
                        onChange={(e) =>
                          e.target.value ? pickProduct(it.key, e.target.value) : clearProduct(it.key)
                        }
                        className={SELECT_CLASS}
                      >
                        <option value="">{t("pickProduct")}</option>
                        {products
                          .filter((pr) => pr.kind === it.kind)
                          .map((pr) => (
                            <option key={pr.id} value={pr.id}>
                              {pr.description} — {formatBRL(pr.unit_price)}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          setItems((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== it.key) : [blankItem()]))
                        }
                        aria-label={t("removeItem")}
                        title={t("removeItem")}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <Input
                      value={it.description}
                      onChange={(e) => updateItem(it.key, { description: e.target.value })}
                      placeholder={t("itemDescription")}
                      disabled={it.deduct}
                      title={it.deduct ? t("descriptionLocked") : undefined}
                      className={INPUT_CLASS}
                    />
                    {(() => {
                      const prod = products.find((x) => x.id === it.productId);
                      const canDeduct = !!prod && prod.kind === "product";
                      return (
                        <label
                          className={`flex flex-wrap items-center gap-2 text-sm ${
                            canDeduct ? "text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={it.deduct}
                            disabled={!canDeduct}
                            onChange={(e) => toggleDeduct(it.key, e.target.checked)}
                          />
                          {t("deductStock")}
                          {canDeduct && (
                            <span className="text-xs text-muted-foreground">
                              ({t("stockBalance", { qty: formatQuantity(prod.stock_qty) })})
                            </span>
                          )}
                        </label>
                      );
                    })()}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {field(
                        t("quantity"),
                        <Input
                          value={it.quantity}
                          onChange={(e) => updateItem(it.key, { quantity: e.target.value })}
                          inputMode="decimal"
                          className={INPUT_CLASS}
                        />,
                      )}
                      {field(
                        t("ncm"),
                        <Input value={it.ncm} onChange={(e) => updateItem(it.key, { ncm: e.target.value })} className={INPUT_CLASS} />,
                      )}
                      {field(
                        t("unitPrice"),
                        <Input
                          value={it.unit_price}
                          onChange={(e) => updateItem(it.key, { unit_price: e.target.value })}
                          inputMode="decimal"
                          placeholder="0,00"
                          className={INPUT_CLASS}
                        />,
                      )}
                      {field(
                        t("lineTotal"),
                        <div className="flex h-9 items-center text-sm font-medium text-foreground">{formatBRL(lt)}</div>,
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" onClick={() => setItems((prev) => [...prev, blankItem()])} className="gap-1.5">
                <Plus className="h-4 w-4" />
                {t("addItem")}
              </Button>
              <p className="text-sm font-semibold text-foreground">
                {t("total")}: {formatBRL(total)}
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t("terms")}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {field(t("deliveryTime"), <Input value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} className={INPUT_CLASS} />)}
              {field(t("paymentTerms"), <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className={INPUT_CLASS} />)}
              {field(t("paymentDue"), <Input value={paymentDue} onChange={(e) => setPaymentDue(e.target.value)} className={INPUT_CLASS} />)}
              {field(t("sellerName"), <Input value={sellerName} onChange={(e) => setSellerName(e.target.value)} className={INPUT_CLASS} />)}
              {field(t("sellerPhone"), <Input value={sellerPhone} onChange={(e) => setSellerPhone(e.target.value)} className={INPUT_CLASS} />)}
            </div>
            {field(t("notes"), <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={INPUT_CLASS} />)}
          </section>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => save(false)}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t("save")}
          </Button>
          <Button disabled={saving} onClick={() => save(true)} className="gap-1.5">
            <FileDown className="h-4 w-4" />
            {t("saveAndPdf")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
