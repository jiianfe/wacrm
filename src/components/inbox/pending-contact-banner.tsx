"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Building2, EyeOff, UserPlus } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { Contact } from "@/types";
import { Button } from "@/components/ui/button";
import { ContactForm } from "@/components/contacts/contact-form";
import { CompanyForm } from "@/components/companies/company-form";

// Free / generic mail providers say nothing about the sender's company.
const GENERIC_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "me.com",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  "globo.com",
  "ig.com.br",
  "proton.me",
  "protonmail.com",
]);

/** "maria@acme.com.br" → { website: "https://acme.com.br", name: "Acme" }. */
function companyHintFromEmail(email?: string | null) {
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  if (!domain || GENERIC_MAIL_DOMAINS.has(domain)) return null;
  const label = domain.split(".")[0];
  if (!label) return null;
  return {
    website: `https://${domain}`,
    name: label.charAt(0).toUpperCase() + label.slice(1),
  };
}

interface PendingContactBannerProps {
  contact: Contact;
  /** Close the conversation (the contact stays pending). */
  onIgnore: () => void;
  /** The contact was accepted — refresh whatever shows it. */
  onRegistered: () => void;
}

/**
 * Shown on a conversation whose contact only exists because they wrote in
 * (migration 066). Nothing is stored as a contact until someone chooses:
 * register the person, register their company (linking the person to it),
 * or ignore — which just closes the conversation.
 */
export function PendingContactBanner({
  contact,
  onIgnore,
  onRegistered,
}: PendingContactBannerProps) {
  const t = useTranslations("Inbox.pendingContact");
  const supabase = createClient();
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [companyFormOpen, setCompanyFormOpen] = useState(false);

  // Memoised: CompanyForm resets its fields whenever these change.
  const prefill = useMemo(() => {
    const hint = companyHintFromEmail(contact.email);
    return {
      trade_name: hint?.name ?? "",
      website: hint?.website ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
    };
  }, [contact.email, contact.phone]);

  const presetContact = useMemo(
    () => ({ id: contact.id, name: contact.name ?? null, phone: contact.phone ?? "" }),
    [contact.id, contact.name, contact.phone],
  );

  async function registerAfterCompany() {
    const { error } = await supabase
      .from("contacts")
      .update({ registration_status: "registered" })
      .eq("id", contact.id);
    if (error) {
      toast.error(t("registerFailed"));
      return;
    }
    onRegistered();
  }

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-primary/20 bg-primary/10 px-4 py-2.5">
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-sm font-medium text-foreground">{t("title")}</p>
          <p className="text-xs text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => setContactFormOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <UserPlus className="size-3.5" />
            {t("registerContact")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setCompanyFormOpen(true)}
            className="border-border text-foreground hover:bg-muted"
          >
            <Building2 className="size-3.5" />
            {t("registerCompany")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onIgnore}
            className="text-muted-foreground hover:text-foreground"
          >
            <EyeOff className="size-3.5" />
            {t("ignore")}
          </Button>
        </div>
      </div>

      <ContactForm
        open={contactFormOpen}
        onOpenChange={setContactFormOpen}
        contact={contact}
        markRegistered
        onSaved={onRegistered}
      />
      <CompanyForm
        open={companyFormOpen}
        onOpenChange={setCompanyFormOpen}
        prefill={prefill}
        presetContact={presetContact}
        onSaved={registerAfterCompany}
      />
    </>
  );
}
