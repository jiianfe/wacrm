"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Building2, Loader2, MessageSquarePlus, Sparkles, UserPlus } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { Contact } from "@/types";
import type { RegistrationProposal } from "@/lib/ai/registration";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ContactForm } from "@/components/contacts/contact-form";
import { CompanyForm } from "@/components/companies/company-form";
import { NewDealButton } from "./new-deal-button";

interface AiRegisterButtonProps {
  conversationId: string;
  contact: Contact;
  /** The contact was saved or registered — refresh whatever shows it. */
  onContactChange: () => void;
  onDealCreated?: () => void;
  /** Drop a suggested question into the message box. */
  onInsertText: (text: string) => void;
}

/**
 * "Register with AI": reads the conversation and proposes the contact,
 * company and deal behind it, plus the questions still worth asking. The
 * agent stays in charge: every proposal opens the regular form, prefilled,
 * and a suggested question only goes into the message box — nothing is saved
 * or sent to the customer until the agent confirms it.
 */
export function AiRegisterButton({
  conversationId,
  contact,
  onContactChange,
  onDealCreated,
  onInsertText,
}: AiRegisterButtonProps) {
  const t = useTranslations("Inbox.aiRegister");
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<RegistrationProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [companyFormOpen, setCompanyFormOpen] = useState(false);

  const pending = contact.registration_status === "pending";

  async function analyse() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setProposal(null);
    try {
      const res = await fetch("/api/ai/registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? t("failed"));
      } else {
        setProposal(data.proposal as RegistrationProposal);
      }
    } catch {
      setError(t("failed"));
    } finally {
      setLoading(false);
    }
  }

  // Memoised: the forms reset their fields whenever these change.
  const contactForForm = useMemo<Contact>(
    () => ({
      ...contact,
      name: proposal?.contact.name || contact.name,
      email: contact.email || proposal?.contact.email || undefined,
    }),
    [contact, proposal],
  );
  const companyPrefill = useMemo(
    () => ({
      legal_name: proposal?.company.legal_name ?? "",
      trade_name: proposal?.company.trade_name ?? "",
      cnpj: proposal?.company.cnpj ?? "",
      phone: proposal?.company.phone || contact.phone || "",
      email: proposal?.company.email || contact.email || "",
    }),
    [proposal, contact.phone, contact.email],
  );
  const presetContact = useMemo(
    () => ({ id: contact.id, name: contactForForm.name ?? null, phone: contact.phone ?? "" }),
    [contact.id, contact.phone, contactForForm.name],
  );

  async function registerAfterCompany() {
    if (pending) {
      const { error: err } = await supabase
        .from("contacts")
        .update({ registration_status: "registered" })
        .eq("id", contact.id);
      if (err) {
        toast.error(t("registerFailed"));
        return;
      }
    }
    onContactChange();
  }

  const company = proposal?.company;
  const companyName = company?.trade_name || company?.legal_name || null;
  const hasCompany = !!(companyName || company?.cnpj);
  const dealNotes = proposal?.deal.summary ?? undefined;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={analyse}
        title={t("tooltip")}
        className="h-7 gap-1.5 border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Sparkles className="size-3.5" />
        <span className="hidden sm:inline">{t("button")}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto bg-popover border-border text-popover-foreground sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("description")}
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("reading")}
            </div>
          )}

          {error && !loading && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-red-400">{error}</p>
              <Button type="button" size="sm" variant="outline" onClick={analyse}>
                {t("retry")}
              </Button>
            </div>
          )}

          {proposal && !loading && (
            <div className="space-y-3">
              <Section icon={<UserPlus className="size-4" />} title={t("contact")}>
                <p className="text-sm text-foreground">
                  {contactForForm.name || t("notIdentified")}
                  {contactForForm.email ? ` · ${contactForForm.email}` : ""}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setContactFormOpen(true)}
                >
                  {pending ? t("registerContact") : t("updateContact")}
                </Button>
              </Section>

              <Section icon={<Building2 className="size-4" />} title={t("company")}>
                <p className="text-sm text-foreground">
                  {hasCompany
                    ? `${companyName ?? ""}${company?.cnpj ? ` · ${company.cnpj}` : ""}`
                    : t("notIdentified")}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCompanyFormOpen(true)}
                >
                  {t("registerCompany")}
                </Button>
              </Section>

              <Section icon={<Sparkles className="size-4" />} title={t("deal")}>
                <p className="text-sm text-foreground">
                  {proposal.deal.title || t("notIdentified")}
                </p>
                {proposal.deal.summary && (
                  <p className="text-xs text-muted-foreground">{proposal.deal.summary}</p>
                )}
                {pending ? (
                  <p className="text-xs text-amber-400">{t("registerFirst")}</p>
                ) : (
                  <NewDealButton
                    contactId={contact.id}
                    onCreated={onDealCreated}
                    presetTitle={proposal.deal.title ?? undefined}
                    presetNotes={dealNotes}
                  />
                )}
              </Section>

              <Section icon={<MessageSquarePlus className="size-4" />} title={t("missing")}>
                {proposal.missing.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("nothingMissing")}</p>
                ) : (
                  <ul className="space-y-2">
                    {proposal.missing.map((m) => (
                      <li key={m.label} className="space-y-1 rounded-md bg-muted/60 p-2">
                        <p className="text-xs font-medium text-foreground">{m.label}</p>
                        <p className="text-xs text-muted-foreground">{m.question}</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            onInsertText(m.question);
                            setOpen(false);
                          }}
                        >
                          {t("useQuestion")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ContactForm
        open={contactFormOpen}
        onOpenChange={setContactFormOpen}
        contact={contactForForm}
        markRegistered
        onSaved={onContactChange}
      />
      <CompanyForm
        open={companyFormOpen}
        onOpenChange={setCompanyFormOpen}
        prefill={companyPrefill}
        presetContact={presetContact}
        onSaved={registerAfterCompany}
      />
    </>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
