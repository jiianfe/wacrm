import { describe, expect, it } from 'vitest';
import {
  DEAL_DOC_MAX_BYTES,
  buildDealDocumentPath,
  formatBytes,
  resolveDocumentMime,
  sanitizeFileName,
} from './deal-documents';

describe('resolveDocumentMime', () => {
  it('accepts allowed declared types', () => {
    expect(resolveDocumentMime({ name: 'orcamento.pdf', type: 'application/pdf' })).toBe(
      'application/pdf',
    );
    expect(resolveDocumentMime({ name: 'nf.xml', type: 'text/xml' })).toBe('text/xml');
  });

  it('falls back to the extension when the browser gives no type', () => {
    expect(resolveDocumentMime({ name: 'NFe-123.XML', type: '' })).toBe('application/xml');
    expect(resolveDocumentMime({ name: 'boleto.pdf', type: 'application/octet-stream' })).toBe(
      'application/pdf',
    );
  });

  it('rejects types the bucket would refuse', () => {
    expect(resolveDocumentMime({ name: 'virus.exe', type: 'application/x-msdownload' })).toBeNull();
    expect(resolveDocumentMime({ name: 'clip.mp4', type: 'video/mp4' })).toBeNull();
    expect(resolveDocumentMime({ name: 'run.exe', type: '' })).toBeNull();
    expect(resolveDocumentMime({ name: 'noextension', type: '' })).toBeNull();
  });
});

describe('sanitizeFileName', () => {
  it('strips accents, path parts and unsafe characters but keeps the extension', () => {
    expect(sanitizeFileName('Orçamento nº 12 (final).PDF')).toBe('Orcamento_n_12_final.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\x\\nota fiscal.xml')).toBe('nota_fiscal.xml');
  });

  it('never returns an empty name', () => {
    expect(sanitizeFileName('???.pdf')).toBe('arquivo.pdf');
    expect(sanitizeFileName('')).toBe('arquivo');
  });

  it('bounds the length', () => {
    expect(sanitizeFileName(`${'a'.repeat(300)}.pdf`).length).toBeLessThanOrEqual(90);
  });
});

describe('buildDealDocumentPath', () => {
  it('uses the account folder the storage policies expect', () => {
    const path = buildDealDocumentPath('acc-uuid', 'deal-uuid', 'Orçamento.pdf', 'u1');
    expect(path).toBe('account-acc-uuid/deal-uuid/u1-Orcamento.pdf');
    expect(path.split('/')[0]).toBe('account-acc-uuid');
  });
});

describe('formatBytes / limits', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(null)).toBe('');
  });

  it('keeps the client limit equal to the bucket limit (10 MB)', () => {
    expect(DEAL_DOC_MAX_BYTES).toBe(10485760);
  });
});
