/**
 * Optional agent signature for outgoing WhatsApp text ("*Jean Felipe:*\nHello").
 *
 * The preference is per person (keyed by user id) and kept in this browser's
 * localStorage; it is OFF until the person turns it on. The signature is added
 * only to what goes to the customer — the bubble in the inbox shows the text
 * as it was sent, so it matches what the customer sees.
 */

const KEY_PREFIX = 'wacrm.signature.';

export function signatureStorageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/** Bold line with the agent's name above the message; unchanged when there is no name. */
export function applySignature(text: string, name: string | null | undefined): string {
  const clean = name?.replace(/[*_~`\s]+/g, ' ').trim();
  if (!clean) return text;
  return `*${clean}:*\n${text}`;
}

export function readSignaturePref(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    return window.localStorage.getItem(signatureStorageKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function writeSignaturePref(userId: string | undefined, enabled: boolean): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(signatureStorageKey(userId), enabled ? '1' : '0');
  } catch {
    // Storage blocked: the toggle still works for this session.
  }
}
