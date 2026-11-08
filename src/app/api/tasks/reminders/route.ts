import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runTaskReminders } from '@/lib/tasks/reminders'

// Scheduled pinger (Hostinger cron job): sends today's task reminders. The
// e-mail sync job calls the same function, so this route is only needed for a
// separate schedule. Same shared secret as the e-mail sync, in `x-cron-secret`.
export async function GET(request: Request) {
  const expected = process.env.EMAIL_CRON_SECRET || process.env.AUTOMATION_CRON_SECRET
  if (!expected) return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '')
  const wanted = Buffer.from(expected)
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const reminded = await runTaskReminders(supabaseAdmin())
  return NextResponse.json({ reminded })
}
