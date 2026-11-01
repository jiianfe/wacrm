/**
 * "Quote with AI": the agent asks the model to read a conversation and
 * propose the quote lines (product + quantity) the customer asked for,
 * matched against the product catalog. Nothing is saved here — the proposal
 * only pre-fills the regular quote form, which the agent reviews.
 */

export interface QuoteDraftItem {
  /** Catalog product id, or null when nothing in the catalog matches. */
  productId: string | null;
  description: string;
  quantity: number;
}

export interface QuoteDraft {
  items: QuoteDraftItem[];
  notes: string | null;
}

export interface CatalogEntry {
  id: string;
  description: string;
  unit_price: number;
  kind: 'product' | 'service';
}

export const QUOTE_DRAFT_SYSTEM_PROMPT = `You help a sales agent prepare a quote from a WhatsApp or e-mail conversation.
Read the conversation and list ONLY what the customer actually asked to buy. Never invent items or quantities.
Match each request to the product catalog you are given. Use the catalog "id" when an entry clearly fits; otherwise use null and describe the item in the customer's words.

Reply with ONE JSON object and nothing else, in this exact shape:
{
  "items": [ { "product_id": string|null, "description": string, "quantity": number } ],
  "notes": string|null
}

Rules:
- "quantity" is a positive number. If the customer did not say how many, use 1.
- "description" is a short Brazilian Portuguese description of the item (copy the catalog description when product_id is set).
- "notes" is one short sentence with delivery address, deadline or conditions the customer mentioned, or null.
- At most 20 items. Empty "items" array when the customer has not asked for anything yet.`;

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s ? s : null;
};

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

/** Turn the model's raw text into safe quote lines; null when it isn't usable JSON. */
export function parseQuoteDraft(raw: string, catalog: CatalogEntry[]): QuoteDraft | null {
  const json = extractJson(raw);
  if (!json || typeof json !== 'object') return null;
  const o = json as { items?: unknown; notes?: unknown };
  const known = new Set(catalog.map((c) => c.id));

  const items = (Array.isArray(o.items) ? o.items : [])
    .map((entry): QuoteDraftItem | null => {
      const it = (entry ?? {}) as Record<string, unknown>;
      const description = str(it.description, 300);
      if (!description) return null;
      const id = typeof it.product_id === 'string' && known.has(it.product_id) ? it.product_id : null;
      const q = typeof it.quantity === 'number' ? it.quantity : Number(it.quantity);
      const quantity = Number.isFinite(q) && q > 0 ? Math.min(Math.round(q * 100) / 100, 100000) : 1;
      return { productId: id, description, quantity };
    })
    .filter((i): i is QuoteDraftItem => i !== null)
    .slice(0, 20);

  return { items, notes: str(o.notes, 500) };
}

/** The catalog and transcript as one user turn, so the final turn is the instruction. */
export function buildQuoteDraftPrompt(
  messages: { role: 'user' | 'assistant'; content: string }[],
  catalog: CatalogEntry[],
): string {
  const cat = catalog.length
    ? catalog
        .map((c) => `- id=${c.id} | ${c.description} | ${c.kind} | R$ ${c.unit_price.toFixed(2)}`)
        .join('\n')
    : '(empty catalog)';
  const lines = messages.map((m) => `${m.role === 'user' ? 'Customer' : 'Agent'}: ${m.content}`);
  return `Product catalog:\n${cat}\n\nConversation:\n${lines.join('\n')}\n\nReturn the JSON now.`;
}
