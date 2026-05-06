// ── Inline Innergy Agent — background.js ───────────────────────
// Service worker: batches events and sends to Supabase.

const SUPABASE_URL      = 'https://suwadpgtqifwufmlwhpk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1d2FkcGd0cWlmd3VmbWx3aHBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODIxMzQsImV4cCI6MjA5MTg1ODEzNH0.iVC__gcDTj4nF8JpwfdWRElUDrFGhI0HNGcpoU4vmoI';
const TABLE             = 'innergy_sessions';
const BATCH_INTERVAL_MS = 30_000;
const STORAGE_QUEUE_KEY = 'innergy_event_queue';
const STORAGE_STATS_KEY = 'innergy_stats';

let pendingEvents = [];

// ── Receive events from content script ───────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'INNERGY_EVENT') return;
  pendingEvents.push(msg.event);
  updateStats(1);
  sendResponse({ ok: true });
});

// ── Flush batch every 30s ────────────────────────────────────
async function flushBatch() {
  // Load any previously failed events from storage
  const stored = await loadQueue();
  const toSend = [...stored, ...pendingEvents];
  pendingEvents = [];

  if (toSend.length === 0) return;

  console.log(`[Innergy Agent] flushing ${toSend.length} event(s)…`);

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(toSend),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }

    console.log(`[Innergy Agent] ✓ synced ${toSend.length} event(s)`);
    await clearQueue();
    await setLastSync(new Date().toISOString());
  } catch (e) {
    console.error('[Innergy Agent] sync failed, queuing for retry:', e.message);
    await saveQueue(toSend);
  }
}

// ── Storage helpers ───────────────────────────────────────────
function loadQueue() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_QUEUE_KEY], (res) => {
      resolve(res[STORAGE_QUEUE_KEY] || []);
    });
  });
}

function saveQueue(events) {
  return new Promise((resolve) => {
    // Cap queue at 2000 events to avoid storage overflow
    const capped = events.slice(-2000);
    chrome.storage.local.set({ [STORAGE_QUEUE_KEY]: capped }, resolve);
  });
}

function clearQueue() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_QUEUE_KEY]: [] }, resolve);
  });
}

function setLastSync(ts) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ innergy_last_sync: ts }, resolve);
  });
}

function updateStats(count) {
  chrome.storage.local.get([STORAGE_STATS_KEY], (res) => {
    const stats = res[STORAGE_STATS_KEY] || { total: 0, session: 0 };
    stats.total   = (stats.total || 0) + count;
    stats.session = (stats.session || 0) + count;
    chrome.storage.local.set({ [STORAGE_STATS_KEY]: stats });
  });
}

// ── Alarm-based batch flush ───────────────────────────────────
// Use alarms so the service worker can wake up even when idle.
chrome.alarms.create('innergy_flush', { periodInMinutes: 0.5 }); // every 30s

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'innergy_flush') flushBatch();
});

// Also flush when the service worker first starts (handles pending queue)
flushBatch();
