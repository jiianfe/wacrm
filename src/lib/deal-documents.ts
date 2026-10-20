import type { DealDocumentCategory } from '@/types';

/** Matches the bucket's `file_size_limit` (migration 068). */
export const DEAL_DOC_MAX_BYTES = 10 * 1024 * 1024;

export const DEAL_DOC_CATEGORIES: readonly DealDocumentCategory[] = [
  'quote',
  'invoice',
  'boleto',
  'other',
];

/** File extension → MIME type, limited to what the bucket accepts. */
const EXTENSION_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  xml: 'application/xml',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
};

/** Every MIME type the bucket's allow-list contains. */
const ALLOWED_MIME = new Set<string>([
  ...Object.values(EXTENSION_MIME),
  'text/xml',
  'application/x-zip-compressed',
]);

/** Extensions to offer in the file picker's `accept` attribute. */
export const DEAL_DOC_ACCEPT = Object.keys(EXTENSION_MIME)
  .map((ext) => `.${ext}`)
  .join(',');

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > -1 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/**
 * The MIME type to upload `file` with, or null when it isn't an allowed
 * document. Browsers often leave `type` empty (NF-e `.xml` on Windows, for
 * example), so the extension is the fallback; a declared type that the
 * bucket would reject is refused here rather than failing server-side.
 */
export function resolveDocumentMime(file: { name: string; type: string }): string | null {
  const declared = file.type.trim().toLowerCase();
  if (declared && ALLOWED_MIME.has(declared)) return declared;
  if (declared && declared !== 'application/octet-stream') return null;
  return EXTENSION_MIME[extensionOf(file.name)] ?? null;
}

/**
 * A storage-safe version of a file name: no path separators, accents or
 * odd characters, original extension kept, bounded length. The real name
 * is kept separately in the database for display.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const ext = extensionOf(base);
  const stem = (ext ? base.slice(0, -(ext.length + 1)) : base)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
  const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 8);
  const body = stem || 'arquivo';
  return safeExt ? `${body}.${safeExt}` : body;
}

/** `account-<account>/<deal>/<uuid>-<safe name>` — the folder the storage policies check. */
export function buildDealDocumentPath(
  accountId: string,
  dealId: string,
  fileName: string,
  uniqueId: string = crypto.randomUUID(),
): string {
  return `account-${accountId}/${dealId}/${uniqueId}-${sanitizeFileName(fileName)}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
