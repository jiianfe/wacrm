import { describe, expect, it } from 'vitest';
import {
  formatCep,
  formatCnpj,
  isValidCnpj,
  normalizeCep,
  normalizeCnpj,
} from './documents';

describe('CNPJ', () => {
  it('accepts valid numeric CNPJs with or without punctuation', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
  });

  it('accepts a valid alphanumeric CNPJ', () => {
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12abc34501de35')).toBe(true);
  });

  it('rejects wrong check digits, bad length and repeated characters', () => {
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('11.222.333/0001')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidCnpj('')).toBe(false);
  });

  it('normalizes and formats progressively', () => {
    expect(normalizeCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatCnpj('1122')).toBe('11.22');
    expect(formatCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35');
  });
});

describe('CEP', () => {
  it('normalizes and formats', () => {
    expect(normalizeCep('60.115-000')).toBe('60115000');
    expect(formatCep('60115000')).toBe('60115-000');
    expect(formatCep('601')).toBe('601');
  });
});
