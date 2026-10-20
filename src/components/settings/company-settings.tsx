"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Loader2, MapPin, Phone } from "lucide-react";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  BR_STATES,
  formatCep,
  formatCnpj,
  isValidCnpj,
  normalizeCep,
  normalizeCnpj,
} from "@/lib/br/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Company profile — the account's own registration data (legal name,
 * CNPJ, state/municipal registration, contact and address), kept in one
 * place so features like quotes can read it instead of re-typing it.
 *
 * Writes go straight to `accounts`; the `accounts_update` RLS policy
 * (017) restricts that to admins+, so non-admins see read-only fields.
 * CNPJ and CEP are stored without punctuation (migration 060).
 */

const FIELDS = [
  "legal_name",
  "trade_name",
  "cnpj",
  "state_registration",
  "municipal_registration",
  "phone",
  "email",
  "website",
  "address_zip",
  "address_street",
  "address_number",
  "address_complement",
  "address_district",
  "address_city",
  "address_state",
] as const;

type Field = (typeof FIELDS)[number];
type Form = Record<Field, string>;

const EMPTY: Form = Object.fromEntries(FIELDS.map((f) => [f, ""])) as Form;

const INPUT_CLASS =
  "bg-muted border-border text-foreground placeholder:text-muted-foreground";

export function CompanySettings() {
  const supabase = createClient();
  const { accountId, canEditSettings, profileLoading } = useAuth();
  const t = useTranslations("Settings.company");

  const [form, setForm] = useState<Form>(EMPTY);
  const [saved, setSaved] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("accounts")
      .select(FIELDS.join(", "))
      .eq("id", accountId)
      .single();
    if (error || !data) {
      toast.error(t("loadFailed"));
      setLoading(false);
      return;
    }
    const row = data as unknown as Record<Field, string | null>;
    const next = { ...EMPTY };
    for (const f of FIELDS) next[f] = row[f] ?? "";
    // Show the stored digits through the same mask the user types with.
    next.cnpj = formatCnpj(next.cnpj);
    next.address_zip = formatCep(next.address_zip);
    setForm(next);
    setSaved(next);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = FIELDS.some((f) => form[f] !== saved[f]);
  const readOnly = !canEditSettings || profileLoading || loading;

  function set(field: Field, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!accountId || !dirty) return;

    const cnpj = normalizeCnpj(form.cnpj);
    if (cnpj && !isValidCnpj(cnpj)) {
      toast.error(t("cnpjInvalid"));
      return;
    }
    const zip = normalizeCep(form.address_zip);
    if (zip && zip.length !== 8) {
      toast.error(t("zipInvalid"));
      return;
    }
    const email = form.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error(t("emailInvalid"));
      return;
    }

    const clean = (v: string) => v.trim() || null;
    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({
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
      })
      .eq("id", accountId);
    setSaving(false);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    const next = { ...form, cnpj: formatCnpj(cnpj), address_zip: formatCep(zip) };
    setForm(next);
    setSaved(next);
    toast.success(t("saveSuccess"));
  }

  function field(
    name: Field,
    label: string,
    opts: {
      placeholder?: string;
      hint?: string;
      className?: string;
      onChange?: (value: string) => string;
      inputMode?: "numeric" | "tel" | "email" | "url" | "text";
    } = {},
  ) {
    return (
      <div className={`grid gap-2 ${opts.className ?? ""}`}>
        <Label htmlFor={`co-${name}`} className="text-muted-foreground">
          {label}
        </Label>
        <Input
          id={`co-${name}`}
          value={form[name]}
          onChange={(e) =>
            set(name, opts.onChange ? opts.onChange(e.target.value) : e.target.value)
          }
          placeholder={opts.placeholder}
          inputMode={opts.inputMode}
          disabled={readOnly}
          className={INPUT_CLASS}
        />
        {opts.hint ? (
          <p className="text-xs text-muted-foreground">{opts.hint}</p>
        ) : null}
      </div>
    );
  }

  return (
    <section className="max-w-3xl animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("loading")}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Building2 className="size-4 text-primary" />
            {t("identityTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("identityDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("legal_name", t("legalName"), { className: "sm:col-span-2" })}
          {field("trade_name", t("tradeName"), { className: "sm:col-span-2" })}
          {field("cnpj", t("cnpj"), {
            placeholder: "00.000.000/0000-00",
            hint: t("cnpjHint"),
            onChange: formatCnpj,
          })}
          {field("state_registration", t("stateRegistration"))}
          {field("municipal_registration", t("municipalRegistration"))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Phone className="size-4 text-primary" />
            {t("contactTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("contactDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("phone", t("phone"), {
            placeholder: "+55 85 90000-0000",
            inputMode: "tel",
          })}
          {field("email", t("email"), {
            placeholder: "contato@empresa.com.br",
            inputMode: "email",
          })}
          {field("website", t("website"), {
            placeholder: "https://",
            inputMode: "url",
            className: "sm:col-span-2",
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <MapPin className="size-4 text-primary" />
            {t("addressTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("addressDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-6">
          {field("address_zip", t("zip"), {
            placeholder: "00000-000",
            inputMode: "numeric",
            onChange: formatCep,
            className: "sm:col-span-2",
          })}
          {field("address_street", t("street"), { className: "sm:col-span-4" })}
          {field("address_number", t("number"), { className: "sm:col-span-2" })}
          {field("address_complement", t("complement"), {
            className: "sm:col-span-4",
          })}
          {field("address_district", t("district"), { className: "sm:col-span-3" })}
          {field("address_city", t("city"), { className: "sm:col-span-2" })}
          <div className="grid gap-2 sm:col-span-1">
            <Label htmlFor="co-address_state" className="text-muted-foreground">
              {t("state")}
            </Label>
            <select
              id="co-address_state"
              value={form.address_state}
              onChange={(e) => set("address_state", e.target.value)}
              disabled={readOnly}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">{t("stateSelect")}</option>
              {BR_STATES.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {!canEditSettings && !profileLoading ? (
        <p className="text-xs text-muted-foreground">{t("adminOnlyHint")}</p>
      ) : null}

      {canEditSettings ? (
        <Button
          onClick={handleSave}
          disabled={saving || !dirty || loading}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t("saving")}
            </>
          ) : (
            t("save")
          )}
        </Button>
      ) : null}
    </section>
  );
}
