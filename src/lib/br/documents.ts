/**
 * Brazilian document helpers (CNPJ, CEP) used by the company profile and
 * the contact CNPJ link.
 *
 * Since July 2026 a CNPJ can be alphanumeric: 12 characters [0-9A-Z]
 * followed by 2 numeric check digits. Letters count as their ASCII code
 * minus 48 (A = 17 … Z = 42) in the check-digit sum; an all-numeric CNPJ
 * works out identical to the classic algorithm.
 */

const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** Strip punctuation/spaces and upper-case: "11.222.333/0001-81" → "11222333000181". */
export function normalizeCnpj(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 14);
}

/** Progressive mask: 00.000.000/0000-00 (works while the user is typing). */
export function formatCnpj(value: string): string {
  const c = normalizeCnpj(value);
  let out = c.slice(0, 2);
  if (c.length > 2) out += '.' + c.slice(2, 5);
  if (c.length > 5) out += '.' + c.slice(5, 8);
  if (c.length > 8) out += '/' + c.slice(8, 12);
  if (c.length > 12) out += '-' + c.slice(12, 14);
  return out;
}

function checkDigit(chars: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += (chars.charCodeAt(i) - 48) * weights[i];
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** True when `value` is a structurally valid CNPJ (numeric or alphanumeric). */
export function isValidCnpj(value: string): boolean {
  const c = normalizeCnpj(value);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c)) return false;
  if (/^(.)\1{13}$/.test(c)) return false;
  const d1 = checkDigit(c, CNPJ_WEIGHTS_1);
  const d2 = checkDigit(c.slice(0, 12) + d1, CNPJ_WEIGHTS_2);
  return c.endsWith(`${d1}${d2}`);
}

/** Digits only, capped at 8: "60.115-000" → "60115000". */
export function normalizeCep(value: string): string {
  return value.replace(/\D/g, '').slice(0, 8);
}

/** Progressive mask: 00000-000. */
export function formatCep(value: string): string {
  const d = normalizeCep(value);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export const BR_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;
