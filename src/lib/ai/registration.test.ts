import { describe, expect, it } from 'vitest';
import { buildRegistrationTranscript, parseRegistrationProposal } from './registration';

describe('parseRegistrationProposal', () => {
  it('reads a plain JSON answer', () => {
    const p = parseRegistrationProposal(
      JSON.stringify({
        contact: { name: ' João ', email: null },
        company: { trade_name: 'Acme', cnpj: '12.345.678/0001-95' },
        deal: { title: 'Recarga de 10 extintores', summary: 'Entrega na sexta' },
        missing: [{ label: 'Endereço', question: 'Qual o endereço de entrega?' }],
      }),
    );
    expect(p?.contact.name).toBe('João');
    expect(p?.company).toMatchObject({ trade_name: 'Acme', cnpj: '12.345.678/0001-95', legal_name: null });
    expect(p?.deal.title).toBe('Recarga de 10 extintores');
    expect(p?.missing).toEqual([{ label: 'Endereço', question: 'Qual o endereço de entrega?' }]);
  });

  it('accepts JSON wrapped in a code fence or prose', () => {
    const p = parseRegistrationProposal('Claro!\n```json\n{"contact":{"name":"Ana"}}\n```');
    expect(p?.contact.name).toBe('Ana');
    expect(p?.missing).toEqual([]);
  });

  it('drops a CNPJ that does not have 14 digits', () => {
    const p = parseRegistrationProposal('{"company":{"cnpj":"123"}}');
    expect(p?.company.cnpj).toBeNull();
  });

  it('ignores malformed missing items and caps them at five', () => {
    const missing = [
      { label: 'a' },
      ...Array.from({ length: 8 }, (_, i) => ({ label: `L${i}`, question: `Q${i}?` })),
    ];
    const p = parseRegistrationProposal(JSON.stringify({ missing }));
    expect(p?.missing).toHaveLength(5);
    expect(p?.missing[0].label).toBe('L0');
  });

  it('returns null when there is no JSON', () => {
    expect(parseRegistrationProposal('desculpe, não consegui')).toBeNull();
    expect(parseRegistrationProposal('{ broken')).toBeNull();
  });
});

describe('buildRegistrationTranscript', () => {
  it('labels each turn and ends with the instruction', () => {
    const t = buildRegistrationTranscript([
      { role: 'user', content: 'Oi' },
      { role: 'assistant', content: 'Olá!' },
    ]);
    expect(t).toContain('Customer: Oi');
    expect(t).toContain('Agent: Olá!');
    expect(t.endsWith('Extract the JSON now.')).toBe(true);
  });
});
