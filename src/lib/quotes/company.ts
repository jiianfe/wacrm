/**
 * Issuer data printed at the top of every quote (from the Ultratec invoice
 * and the previous quote generator). Kept as constants for now: the CRM has a
 * single issuing company.
 */
export const QUOTE_ISSUER = {
  tradeName: 'ULTRATEC',
  legalName: 'ULTRATEC ENGENHARIA E EQUIPAMENTOS CONTRA INCENDIO LTDA',
  cnpj: '68.746.180/0001-99',
  address: 'Rua Missão Velha, 86 - São João do Tauape',
  city: 'Fortaleza - CE - 60130-330',
  phone: '(85)3235-8310',
  whatsapp: '(85)93300-1477',
  email: 'ultratec@ultratecextintores.com.br',
} as const

/** Defaults for a new quote. */
export const QUOTE_DEFAULTS = {
  /** First number offered when the account has no quote yet. */
  firstNumber: 1387,
  validityDays: 20,
  deliveryTime: '5 dia(s)',
  paymentTerms: 'À vista',
  sellerPhone: '(85)93300-1477',
} as const
