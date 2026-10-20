import { ImapFlow } from 'imapflow'
import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { assertPublicHost } from './host-guard'

/** A row of `email_accounts` (migration 064). */
export interface EmailAccountRow {
  id: string
  account_id: string
  address: string
  username: string
  password_encrypted: string
  imap_host: string
  imap_port: number
  imap_secure: boolean
  smtp_host: string
  smtp_port: number
  smtp_secure: boolean
  enabled: boolean
  last_uid: number | null
  uid_validity: number | null
  last_synced_at: string | null
  last_error: string | null
  sync_started_at: string | null
}

/** What the browser may see: everything except the password. */
export interface PublicEmailAccount {
  address: string
  username: string
  imap_host: string
  imap_port: number
  imap_secure: boolean
  smtp_host: string
  smtp_port: number
  smtp_secure: boolean
  enabled: boolean
  last_synced_at: string | null
  last_error: string | null
}

export function toPublicAccount(row: EmailAccountRow): PublicEmailAccount {
  return {
    address: row.address,
    username: row.username,
    imap_host: row.imap_host,
    imap_port: row.imap_port,
    imap_secure: row.imap_secure,
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    smtp_secure: row.smtp_secure,
    enabled: row.enabled,
    last_synced_at: row.last_synced_at,
    last_error: row.last_error,
  }
}

export async function loadEmailAccount(
  db: SupabaseClient,
  accountId: string,
): Promise<EmailAccountRow | null> {
  const { data } = await db
    .from('email_accounts')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  return (data as EmailAccountRow | null) ?? null
}

/**
 * The server's certificate was not trusted. Typical causes: an antivirus
 * or proxy re-signing mail traffic with its own certificate (common on a
 * developer PC), or a genuinely expired/self-signed certificate.
 */
export function isTlsCertError(code: string | undefined): boolean {
  return (
    !!code &&
    /^(SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|CERT_HAS_EXPIRED|ERR_TLS_CERT_ALTNAME_INVALID)$/.test(
      code,
    )
  )
}

export interface ImapConnectionInput {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
}

/**
 * Build an (unconnected) IMAP client. Timeouts keep a dead server from
 * hanging a request; `logger: false` keeps credentials out of the logs.
 */
export async function createImapClient(input: ImapConnectionInput): Promise<ImapFlow> {
  await assertPublicHost(input.host)
  return new ImapFlow({
    host: input.host,
    port: input.port,
    secure: input.secure,
    auth: { user: input.username, pass: input.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  })
}

export async function imapClientForAccount(row: EmailAccountRow): Promise<ImapFlow> {
  return createImapClient({
    host: row.imap_host,
    port: row.imap_port,
    secure: row.imap_secure,
    username: row.username,
    password: decrypt(row.password_encrypted),
  })
}

/**
 * Open and close a connection to prove host, port and credentials work.
 * Returns a short machine code on failure (never the raw server text,
 * which can echo the username).
 */
export async function testImapLogin(
  input: ImapConnectionInput,
): Promise<{ ok: true } | { ok: false; code: 'auth' | 'connect' | 'host' | 'tls' }> {
  let client: ImapFlow
  try {
    client = await createImapClient(input)
  } catch {
    return { ok: false, code: 'host' }
  }
  try {
    await client.connect()
    await client.logout()
    return { ok: true }
  } catch (err) {
    const e = err as { authenticationFailed?: boolean; code?: string }
    try {
      client.close()
    } catch {
      // already closed
    }
    if (e.authenticationFailed) return { ok: false, code: 'auth' }
    if (isTlsCertError(e.code)) return { ok: false, code: 'tls' }
    return { ok: false, code: 'connect' }
  }
}
