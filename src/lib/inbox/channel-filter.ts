import type { Conversation, Message } from '@/types';

export type ChannelFilter = 'all' | 'whatsapp' | 'email';

export function parseChannelFilter(value: string | null | undefined): ChannelFilter {
  return value === 'whatsapp' || value === 'email' ? value : 'all';
}

/**
 * Does the conversation have messages on this channel? The flags come from
 * migration 065; a row loaded before it existed has neither, and then it is
 * a WhatsApp conversation (the only channel that existed).
 */
export function matchesChannel(c: Conversation, channel: ChannelFilter): boolean {
  if (channel === 'all') return true;
  if (channel === 'email') return c.has_email === true;
  return c.has_whatsapp ?? true;
}

/** The messages of one channel; a message with no `channel` is WhatsApp. */
export function filterMessagesByChannel(
  messages: Message[],
  channel: ChannelFilter,
): Message[] {
  if (channel === 'all') return messages;
  return messages.filter((m) => (m.channel ?? 'whatsapp') === channel);
}
