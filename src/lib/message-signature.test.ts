import { describe, expect, it } from 'vitest';
import { applySignature, signatureStorageKey } from './message-signature';

describe('applySignature', () => {
  it('puts the name in bold on its own line above the message', () => {
    expect(applySignature('Bom dia!', 'Jean Felipe')).toBe('*Jean Felipe:*\nBom dia!');
  });

  it('leaves the text alone without a name', () => {
    expect(applySignature('Bom dia!', null)).toBe('Bom dia!');
    expect(applySignature('Bom dia!', '   ')).toBe('Bom dia!');
  });

  it('strips WhatsApp formatting characters from the name', () => {
    expect(applySignature('Oi', '*Jean_ `Felipe`')).toBe('*Jean Felipe:*\nOi');
  });
});

describe('signatureStorageKey', () => {
  it('is per user', () => {
    expect(signatureStorageKey('a')).not.toBe(signatureStorageKey('b'));
  });
});
