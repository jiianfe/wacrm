import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

import { imapClientForAccount, isTlsCertError, type EmailAccountRow } from './account'
import { ingestInboundEmail } from './inbound'

/** On the first run only mail from this many days back is imported. */
const FIRST_SYNC_DAYS = 14
/** Messages handled per run; the rest is picked up by the next run. */
const MAX_PER_RUN = 40
/** A sync claim older than this is considered dead and may be retaken. */
const STALE_CLAIM_MS = 5 * 60_000
/** Larger messages are cut here: only the text body is kept anyway. */
const MAX_SOURCE_BYTES = 2_000_000

export type SyncResult =
  | { status: 'ok'; imported: number; scanned: number; remaining: boolean }
  | { status: 'busy' }
  | { status: 'error'; code: 'auth' | 'connect' | 'host' | 'tls' | 'internal' }

function errorCode(err: unknown): 'auth' | 'connect' | 'host' | 'tls' | 'internal' {
  const e = err as { authenticationFailed?: boolean; name?: string; code?: string }
  if (e?.authenticationFailed) return 'auth'
  if (e?.name === 'EmailHostError') return 'host'
  if (isTlsCertError(e?.code)) return 'tls'
  if (e?.code && /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|CERT|TLS/i.test(e.code)) {
    return 'connect'
  }
  return 'internal'
}

/**
 * Import new INBOX mail for one account. Read-only on the mailbox: mail is
 * fetched with BODY.PEEK, so it stays unread in the webmail.
 */
export async function syncEmailAccount(
  db: SupabaseClient,
  row: EmailAccountRow,
): Promise<SyncResult> {
  // Claim the account so overlapping triggers (cron + a browser) can't
  // import the same mail twice.
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const { data: claimed } = await db
    .from('email_accounts')
    .update({ sync_started_at: new Date().toISOString() })
    .eq('id', row.id)
    .or(`sync_started_at.is.null,sync_started_at.lt.${staleBefore}`)
    .select('id')
  if (!claimed || claimed.length === 0) return { status: 'busy' }

  const finish = (patch: Record<string, unknown>) =>
    db
      .from('email_accounts')
      .update({ sync_started_at: null, ...patch })
      .eq('id', row.id)

  let client: ImapFlow | null = null
  try {
    const { data: account } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', row.account_id)
      .maybeSingle()
    const ownerUserId = (account as { owner_user_id: string } | null)?.owner_user_id
    if (!ownerUserId) throw new Error('account owner not found')

    client = await imapClientForAccount(row)
    await client.connect()

    let imported = 0
    let scanned = 0
    let remaining = false
    let lastUid = row.last_uid
    let uidValidity = row.uid_validity

    const lock = await client.getMailboxLock('INBOX')
    try {
      const mailbox = client.mailbox
      if (!mailbox) throw new Error('INBOX not available')
      const validity = Number(mailbox.uidValidity)
      const uidNext = Number(mailbox.uidNext)

      // The server renumbered the mailbox: our checkpoint is meaningless.
      const firstRun = row.last_uid == null || row.uid_validity !== validity
      uidValidity = validity

      let uids: number[]
      if (firstRun) {
        const since = new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000)
        uids = (await client.search({ since }, { uid: true })) || []
      } else {
        const found = (await client.search({ uid: `${row.last_uid! + 1}:*` }, { uid: true })) || []
        // `n:*` always includes the newest message even when it is older.
        uids = found.filter((u) => u > row.last_uid!)
      }
      uids.sort((a, b) => a - b)
      scanned = uids.length
      remaining = uids.length > MAX_PER_RUN
      const batch = uids.slice(0, MAX_PER_RUN)

      for (const uid of batch) {
        try {
          const msg = await client.fetchOne(
            String(uid),
            { source: { maxLength: MAX_SOURCE_BYTES } },
            { uid: true },
          )
          if (msg && msg.source) {
            const parsed = await simpleParser(msg.source)
            const result = await ingestInboundEmail(db, {
              accountId: row.account_id,
              ownerUserId,
              mailboxAddress: row.address,
              parsed,
            })
            if (result.inserted) imported += 1
          }
        } catch (err) {
          // One bad message must not block the mailbox forever.
          console.error('[email-sync] message', uid, 'skipped:', (err as Error).message)
        }
        lastUid = uid
      }

      // First run with nothing to import: start from "now" next time.
      if (firstRun && batch.length === 0) lastUid = Math.max(uidNext - 1, 0)
    } finally {
      lock.release()
    }

    await client.logout().catch(() => undefined)

    await finish({
      last_uid: lastUid,
      uid_validity: uidValidity,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    })
    return { status: 'ok', imported, scanned, remaining }
  } catch (err) {
    const code = errorCode(err)
    console.error('[email-sync] account', row.id, 'failed:', code, (err as Error).message)
    try {
      client?.close()
    } catch {
      // already closed
    }
    await finish({ last_error: code })
    return { status: 'error', code }
  }
}
