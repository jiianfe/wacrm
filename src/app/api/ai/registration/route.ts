import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { generateReply } from '@/lib/ai/generate'
import {
  REGISTRATION_SYSTEM_PROMPT,
  buildRegistrationTranscript,
  parseRegistrationProposal,
} from '@/lib/ai/registration'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/ai/registration  (agent+)
 *
 * Body: { conversation_id }
 * Returns: { proposal } — the contact, company and deal the model found in
 * the conversation, plus the questions still worth asking the customer.
 *
 * Read-only: nothing is saved and nothing is sent to the customer. The
 * agent reviews the proposal and confirms it in the normal forms.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const userLimit = checkRateLimit(`ai-registration:${userId}`, RATE_LIMITS.aiDraft)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const accountLimit = checkRateLimit(
      `ai-registration-acct:${accountId}`,
      RATE_LIMITS.aiDraftAccount,
    )
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = await request.json().catch(() => null)
    const conversationId =
      body && typeof body.conversation_id === 'string' ? body.conversation_id : ''
    if (!conversationId) {
      return NextResponse.json({ error: t('ai.conversationIdRequired') }, { status: 400 })
    }

    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/registration] conversation lookup error:', convErr)
      return NextResponse.json({ error: t('common.failedToLoadConversation') }, { status: 500 })
    }
    if (!conversation) {
      return NextResponse.json({ error: t('common.conversationNotFound') }, { status: 404 })
    }

    const config = await loadAiConfig(supabase, accountId).catch((err) => {
      console.error('[ai/registration] loadAiConfig error:', err)
      throw new AiError(t('ai.storedKeyUndecryptable'), {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        { error: t('ai.notConfigured'), code: 'ai_not_configured' },
        { status: 400 },
      )
    }

    const messages = await buildConversationContext(supabase, conversationId)
    if (messages.length === 0) {
      return NextResponse.json(
        { error: t('ai.noMessages'), code: 'no_messages' },
        { status: 400 },
      )
    }

    const { text, usage } = await generateReply({
      config,
      systemPrompt: REGISTRATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildRegistrationTranscript(messages) }],
    })

    try {
      void logAiUsage(supabaseAdmin(), {
        accountId,
        conversationId,
        mode: 'draft',
        provider: config.provider,
        model: config.model,
        usage,
      })
    } catch (logErr) {
      console.error('[ai/registration] usage log skipped:', logErr)
    }

    const proposal = parseRegistrationProposal(text)
    if (!proposal) {
      return NextResponse.json(
        { error: t('ai.registrationUnreadable'), code: 'unreadable' },
        { status: 502 },
      )
    }
    return NextResponse.json({ proposal })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
