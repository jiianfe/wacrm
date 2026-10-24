/**
 * "Register with AI": the agent asks the model to read a conversation and
 * propose the contact, company and deal behind it, plus what is still
 * missing (with a ready-to-send question for each gap). Nothing is saved
 * here — the agent reviews the proposal and confirms in the usual forms.
 */

export interface RegistrationProposal {
  contact: { name: string | null; email: string | null };
  company: {
    legal_name: string | null;
    trade_name: string | null;
    cnpj: string | null;
    phone: string | null;
    email: string | null;
  };
  deal: { title: string | null; summary: string | null };
  missing: { label: string; question: string }[];
}

export const REGISTRATION_SYSTEM_PROMPT = `You help a sales agent register a customer from a WhatsApp or e-mail conversation.
Read the conversation and extract only what the customer actually said. Never invent or guess data.

Reply with ONE JSON object and nothing else, in this exact shape:
{
  "contact": { "name": string|null, "email": string|null },
  "company": { "legal_name": string|null, "trade_name": string|null, "cnpj": string|null, "phone": string|null, "email": string|null },
  "deal": { "title": string|null, "summary": string|null },
  "missing": [ { "label": string, "question": string } ]
}

Rules:
- Use null for anything not stated. "cnpj" is digits and punctuation exactly as written by the customer.
- "deal.title" is a short title for what the customer wants (e.g. "Recarga de 10 extintores - Acme"). "deal.summary" is 1-3 sentences with the details (quantities, products, address, deadlines).
- "missing" lists information a salesperson still needs to open the deal (company, CNPJ, quantities, product, delivery address, deadline...). Each item has a short "label" and a polite, ready-to-send "question" written to the customer in the same language the customer uses. At most 5 items, most important first. Empty array if nothing important is missing.
- Write labels in Brazilian Portuguese.`;

const str = (v: unknown, max = 300): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s ? s : null;
};

/** A CNPJ is accepted only when it has 14 digits; anything else is dropped. */
function cnpjOrNull(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  return s.replace(/\D/g, '').length === 14 ? s : null;
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Turn the model's raw text into a safe proposal; null when it isn't usable JSON. */
export function parseRegistrationProposal(raw: string): RegistrationProposal | null {
  const json = extractJson(raw);
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, Record<string, unknown> | unknown[] | undefined>;
  const contact = (o.contact ?? {}) as Record<string, unknown>;
  const company = (o.company ?? {}) as Record<string, unknown>;
  const deal = (o.deal ?? {}) as Record<string, unknown>;

  const missing = (Array.isArray(o.missing) ? o.missing : [])
    .map((m) => {
      const item = (m ?? {}) as Record<string, unknown>;
      const label = str(item.label, 80);
      const question = str(item.question, 500);
      return label && question ? { label, question } : null;
    })
    .filter((m): m is { label: string; question: string } => m !== null)
    .slice(0, 5);

  return {
    contact: { name: str(contact.name, 120), email: str(contact.email, 200) },
    company: {
      legal_name: str(company.legal_name, 200),
      trade_name: str(company.trade_name, 200),
      cnpj: cnpjOrNull(company.cnpj),
      phone: str(company.phone, 40),
      email: str(company.email, 200),
    },
    deal: { title: str(deal.title, 150), summary: str(deal.summary, 1500) },
    missing,
  };
}

/** The transcript as one user turn, so the final turn is always the instruction. */
export function buildRegistrationTranscript(
  messages: { role: 'user' | 'assistant'; content: string }[],
): string {
  const lines = messages.map(
    (m) => `${m.role === 'user' ? 'Customer' : 'Agent'}: ${m.content}`,
  );
  return `Conversation:\n${lines.join('\n')}\n\nExtract the JSON now.`;
}
