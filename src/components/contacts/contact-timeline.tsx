'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  CheckCircle2,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  PlusCircle,
  StickyNote,
  XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import type { ContactNote, Deal, DealAttachment, DealNote } from '@/types';

interface TimelineMessage {
  id: string;
  sender_type: 'customer' | 'agent' | 'bot';
  content_type: string;
  content_text: string | null;
  template_name: string | null;
  email_subject: string | null;
  created_at: string;
}

type TimelineEvent =
  | { id: string; at: string; kind: 'deal-created'; deal: Deal }
  | { id: string; at: string; kind: 'deal-won' | 'deal-lost'; deal: Deal }
  | { id: string; at: string; kind: 'deal-note'; note: DealNote; dealTitle: string }
  | { id: string; at: string; kind: 'attachment'; file: DealAttachment; dealTitle: string }
  | { id: string; at: string; kind: 'contact-note'; note: ContactNote }
  | { id: string; at: string; kind: 'messages'; messages: TimelineMessage[] };

// Newest messages first would hide the start of a long relationship, so
// pull a generous window; one year of chat with a customer is far below it.
const MESSAGE_LIMIT = 2000;

/** Local calendar day, used to fold a day of chat into one entry. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function messagePreview(m: TimelineMessage): string {
  if (m.content_text) return m.content_text;
  if (m.email_subject) return m.email_subject;
  if (m.template_name) return m.template_name;
  return `[${m.content_type}]`;
}

export function ContactTimeline({ contactId }: { contactId: string }) {
  const t = useTranslations('Contacts.detailView.timeline');
  const locale = useLocale();
  const { defaultCurrency } = useAuth();
  const [supabase] = useState(() => createClient());
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);

      const [dealsRes, contactNotesRes, convRes] = await Promise.all([
        supabase.from('deals').select('*').eq('contact_id', contactId),
        supabase.from('contact_notes').select('*').eq('contact_id', contactId),
        supabase.from('conversations').select('id').eq('contact_id', contactId),
      ]);

      const deals = (dealsRes.data ?? []) as Deal[];
      const dealIds = deals.map((d) => d.id);
      const dealTitle = new Map(deals.map((d) => [d.id, d.title]));
      const conversationIds = (convRes.data ?? []).map((c: { id: string }) => c.id);

      const [dealNotesRes, attachmentsRes, messagesRes] = await Promise.all([
        dealIds.length
          ? supabase.from('deal_notes').select('*').in('deal_id', dealIds)
          : Promise.resolve({ data: [] }),
        dealIds.length
          ? supabase.from('deal_attachments').select('*').in('deal_id', dealIds)
          : Promise.resolve({ data: [] }),
        conversationIds.length
          ? supabase
              .from('messages')
              .select('id, sender_type, content_type, content_text, template_name, email_subject, created_at')
              .in('conversation_id', conversationIds)
              .order('created_at', { ascending: false })
              .limit(MESSAGE_LIMIT)
          : Promise.resolve({ data: [] }),
      ]);

      if (cancelled) return;

      const out: TimelineEvent[] = [];

      for (const deal of deals) {
        out.push({ id: `dc-${deal.id}`, at: deal.created_at, kind: 'deal-created', deal });
        if (deal.status === 'won' || deal.status === 'lost') {
          out.push({
            id: `dx-${deal.id}`,
            at: deal.closed_at ?? deal.updated_at ?? deal.created_at,
            kind: deal.status === 'won' ? 'deal-won' : 'deal-lost',
            deal,
          });
        }
      }
      for (const note of (dealNotesRes.data ?? []) as DealNote[]) {
        out.push({
          id: `dn-${note.id}`,
          at: note.created_at,
          kind: 'deal-note',
          note,
          dealTitle: dealTitle.get(note.deal_id) ?? '',
        });
      }
      for (const file of (attachmentsRes.data ?? []) as DealAttachment[]) {
        out.push({
          id: `da-${file.id}`,
          at: file.created_at,
          kind: 'attachment',
          file,
          dealTitle: dealTitle.get(file.deal_id) ?? '',
        });
      }
      for (const note of (contactNotesRes.data ?? []) as ContactNote[]) {
        out.push({ id: `cn-${note.id}`, at: note.created_at, kind: 'contact-note', note });
      }

      const byDay = new Map<string, TimelineMessage[]>();
      for (const m of (messagesRes.data ?? []) as TimelineMessage[]) {
        const key = dayKey(m.created_at);
        const list = byDay.get(key);
        if (list) list.push(m);
        else byDay.set(key, [m]);
      }
      for (const [key, list] of byDay) {
        // Rows arrive newest-first; show each day's chat in reading order.
        const ordered = [...list].reverse();
        out.push({ id: `m-${key}`, at: ordered[ordered.length - 1].created_at, kind: 'messages', messages: ordered });
      }

      out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      setEvents(out);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId, supabase]);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }),
    [locale],
  );
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
    [locale],
  );

  function toggleDay(id: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (events.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <ol className="space-y-3">
      {events.map((ev) => {
        let icon = <PlusCircle className="size-4 text-muted-foreground" />;
        let title = '';
        let detail: string | null = null;

        switch (ev.kind) {
          case 'deal-created':
            title = t('dealCreated', { title: ev.deal.title });
            detail = t('dealValue', {
              value: formatCurrency(ev.deal.value ?? 0, ev.deal.currency || defaultCurrency),
            });
            break;
          case 'deal-won':
            icon = <CheckCircle2 className="size-4 text-green-500" />;
            title = t('dealWon', { title: ev.deal.title });
            detail = t('dealValue', {
              value: formatCurrency(ev.deal.value ?? 0, ev.deal.currency || defaultCurrency),
            });
            break;
          case 'deal-lost':
            icon = <XCircle className="size-4 text-red-400" />;
            title = t('dealLost', { title: ev.deal.title });
            break;
          case 'deal-note':
            icon = <StickyNote className="size-4 text-amber-500" />;
            title = t('dealNote', { title: ev.dealTitle });
            detail = ev.note.body;
            break;
          case 'attachment':
            icon = <Paperclip className="size-4 text-blue-400" />;
            title = t('attachment', { title: ev.dealTitle });
            detail = ev.file.file_name;
            break;
          case 'contact-note':
            icon = <FileText className="size-4 text-amber-500" />;
            title = t('contactNote');
            detail = ev.note.note_text;
            break;
          case 'messages': {
            icon = <MessageSquare className="size-4 text-primary" />;
            const received = ev.messages.filter((m) => m.sender_type === 'customer').length;
            title = t('messagesDay', { received, sent: ev.messages.length - received });
            break;
          }
        }

        const expanded = ev.kind === 'messages' && expandedDays.has(ev.id);

        return (
          <li key={ev.id} className="flex gap-3">
            <div className="mt-0.5 shrink-0">{icon}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{title}</p>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {dateFmt.format(new Date(ev.at))}
                </span>
              </div>
              {detail && (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {detail}
                </p>
              )}
              {ev.kind === 'messages' && (
                <>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => toggleDay(ev.id)}
                  >
                    {expanded ? t('hideMessages') : t('showMessages')}
                  </Button>
                  {expanded && (
                    <ul className="mt-1 space-y-1 rounded-md bg-muted/50 p-2">
                      {ev.messages.map((m) => (
                        <li key={m.id} className="text-xs text-muted-foreground">
                          <span className="text-foreground">
                            {timeFmt.format(new Date(m.created_at))}{' '}
                            {m.sender_type === 'customer' ? t('fromCustomer') : t('fromUs')}:
                          </span>{' '}
                          <span className="whitespace-pre-wrap break-words">{messagePreview(m)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
