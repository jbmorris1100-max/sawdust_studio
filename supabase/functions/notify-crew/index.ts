// notify-crew — Supabase Edge Function
// Triggered by a Database Webhook on messages INSERT.
// When the supervisor sends a message, pushes to all registered crew devices.
//
// Deploy:
//   supabase functions deploy notify-crew
//
// Then wire the webhook:
//   Supabase Dashboard → Database → Webhooks → Create webhook
//   Table: messages | Event: INSERT | Type: Supabase Edge Functions → notify-crew

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();

    // Supabase webhook payload shape: { type, table, schema, record, old_record }
    const record = payload.record ?? payload;

    // Only notify for supervisor messages
    if (record.sender_name !== 'Supervisor') {
      return json({ skipped: true, reason: 'not a supervisor message' });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Fetch all registered device tokens
    const { data: rows, error } = await supabase
      .from('device_tokens')
      .select('token, name, dept');

    if (error) {
      console.error('device_tokens fetch error:', error.message);
      return json({ error: error.message }, 500);
    }

    if (!rows || rows.length === 0) {
      return json({ sent: 0, reason: 'no registered devices' });
    }

    // Build Expo push messages
    const messages = rows.map((row) => ({
      to:       row.token,
      title:    'Supervisor',
      body:     record.body,
      sound:    'default',
      priority: 'high',
      data:     { screen: 'Messages' },
      // Include sender dept for context
      subtitle: record.dept ?? undefined,
    }));

    // Expo Push API accepts max 100 messages per request
    const results: unknown[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      const res = await fetch(EXPO_PUSH_URL, {
        method:  'POST',
        headers: {
          'Content-Type':    'application/json',
          'Accept':          'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error('Expo push HTTP error:', res.status, text);
        results.push({ error: text, status: res.status });
      } else {
        const data = await res.json();
        console.log('Expo push batch result:', JSON.stringify(data));
        results.push(data);
      }
    }

    return json({ sent: messages.length, results });

  } catch (err) {
    console.error('notify-crew unhandled error:', err);
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
