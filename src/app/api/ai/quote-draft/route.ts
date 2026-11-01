import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { generateReply } from '@/lib/ai/generate'
import {
  QUOTE_DRAFT_SYSTEM_PROMPT,
  buildQuoteDraftPrompt,
  parseQuoteDraft,
  type CatalogEntry,
} from '@/lib/ai/quote-draft'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/ai/quote-draft  (agent+)
 *
 * Body: { conversation_id }
 * Returns: { draft } — the quote lines (matched to the product catalog) the
 * customer asked for in the conversation.
 *
 * Read-only: nothing is saved and nothing is sent to the customer. The
 * agent reviews the draft in the normal quote form.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const userLimit = checkRateLimit(`ai-quote-draft:${userId}`, RATE_LIMITS.aiDraft)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const accountLimit = checkRateLimit(
      `ai-quote-draft-acct:${accountId}`,
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
      console.error('[ai/quote-draft] conversation lookup error:', convErr)
      return NextResponse.json({ error: t('common.failedToLoadConversation') }, { status: 500 })
    }
    if (!conversation) {
      return NextResponse.json({ error: t('common.conversationNotFound') }, { status: 404 })
    }

    const config = await loadAiConfig(supabase, accountId).catch((err) => {
      console.error('[ai/quote-draft] loadAiConfig error:', err)
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

    const { data: products } = await supabase
      .from('products')
      .select('id, description, unit_price, kind')
      .eq('active', true)
      .order('description')
      .limit(300)
    const catalog = ((products ?? []) as CatalogEntry[]).map((p) => ({
      ...p,
      unit_price: Number(p.unit_price),
    }))

    const { text, usage } = await generateReply({
      config,
      systemPrompt: QUOTE_DRAFT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildQuoteDraftPrompt(messages, catalog) }],
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
      console.error('[ai/quote-draft] usage log skipped:', logErr)
    }

    const draft = parseQuoteDraft(text, catalog)
    if (!draft) {
      return NextResponse.json(
        { error: t('ai.registrationUnreadable'), code: 'unreadable' },
        { status: 502 },
      )
    }
    return NextResponse.json({ draft })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
