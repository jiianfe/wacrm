import type { SupabaseClient } from '@supabase/supabase-js'

import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { findOrCreateConversationRow } from '@/lib/whatsapp/resolve-conversation'

/** Escape `%`, `_` and `\` so an address can be used with ILIKE as an exact match. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * The contact and conversation an e-mail to `address` belongs to: the
 * contact is found by e-mail (case-insensitive) or created — registered,
 * because a person typed the address on purpose — and the contact's single
 * conversation is found or created.
 */
export async function resolveConversationForAddress(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  address: string,
): Promise<{ conversationId: string; contactId: string }> {
  const email = address.trim().toLowerCase()
  const find = async () => {
    const { data } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .ilike('email', escapeLike(email))
      .order('created_at', { ascending: true })
      .limit(1)
    return (data?.[0]?.id as string | undefined) ?? null
  }

  let contactId = await find()
  if (!contactId) {
    const { data: created, error } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: userId,
        // Contacts without a phone are allowed (migration 022).
        phone: '',
        name: email,
        email,
        registration_status: 'registered',
      })
      .select('id')
      .single()
    if (error || !created) {
      if (!isUniqueViolation(error)) throw error ?? new Error('contact insert failed')
      contactId = await find()
      if (!contactId) throw error
    } else {
      contactId = created.id as string
    }
  }

  const conversationId = await findOrCreateConversationRow(db, accountId, contactId, userId)
  return { conversationId, contactId }
}
