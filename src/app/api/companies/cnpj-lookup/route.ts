import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isValidCnpj, normalizeCnpj } from '@/lib/br/documents'

// Looks a CNPJ up on BrasilAPI (public Receita Federal data) so the company
// form can pre-fill the registration. Runs server-side: only the CNPJ
// leaves the app, and the caller must be signed in as agent or above.
//
// Errors are machine codes (`invalid`, `not_found`, `unavailable`) that the
// form maps to translated messages.

const BRASIL_API = 'https://brasilapi.com.br/api/cnpj/v1'

interface BrasilApiCnpj {
  razao_social?: string | null
  nome_fantasia?: string | null
  descricao_situacao_cadastral?: string | null
  ddd_telefone_1?: string | null
  email?: string | null
  cep?: string | null
  descricao_tipo_de_logradouro?: string | null
  logradouro?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  municipio?: string | null
  uf?: string | null
}

function clean(value: string | null | undefined): string | null {
  const v = (value ?? '').trim()
  return v ? v : null
}

function formatPhone(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  return clean(raw)
}

export async function GET(request: Request) {
  try {
    await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const cnpj = normalizeCnpj(new URL(request.url).searchParams.get('cnpj') ?? '')
  if (!isValidCnpj(cnpj)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }

  let res: Response
  try {
    res = await fetch(`${BRASIL_API}/${cnpj}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
      // BrasilAPI answers 403 to the bare Node fetch user agent, so identify
      // the app explicitly.
      headers: {
        Accept: 'application/json',
        'User-Agent': 'wacrm (CRM; company registration lookup)',
      },
    })
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 502 })
  }

  if (res.status === 404 || res.status === 400) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!res.ok) {
    return NextResponse.json({ error: 'unavailable' }, { status: 502 })
  }

  const body = (await res.json().catch(() => null)) as BrasilApiCnpj | null
  if (!body) return NextResponse.json({ error: 'unavailable' }, { status: 502 })

  const street = [clean(body.descricao_tipo_de_logradouro), clean(body.logradouro)]
    .filter(Boolean)
    .join(' ')

  return NextResponse.json({
    data: {
      legal_name: clean(body.razao_social),
      trade_name: clean(body.nome_fantasia),
      situation: clean(body.descricao_situacao_cadastral),
      phone: formatPhone(body.ddd_telefone_1),
      email: clean(body.email)?.toLowerCase() ?? null,
      address_zip: clean(body.cep)?.replace(/\D/g, '') ?? null,
      address_street: clean(street),
      address_number: clean(body.numero),
      address_complement: clean(body.complemento),
      address_district: clean(body.bairro),
      address_city: clean(body.municipio),
      address_state: clean(body.uf)?.toUpperCase() ?? null,
    },
  })
}
