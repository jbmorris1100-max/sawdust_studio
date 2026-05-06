// ── Inline Innergy Agent — content.js ──────────────────────────
// Injected into every app.innergy.com page.

const JOB_RE  = /P-\d{2}-\d{4}/g;
const WO_RE   = /P-\d{2}-\d{4}-\d{3}[a-z]/g;
const DOLLAR_RE = /\$[\d,]+(?:\.\d{2})?/g;
const HOURS_RE  = /\b\d+(?:\.\d+)?\s*h(?:rs?|ours?)?\b/gi;
const STATUS_LABELS = [
  'pending','in progress','complete','invoiced','paid','hold','cancelled',
  'approved','draft','submitted','review','active','closed',
];

let sessionId = null;
let pageEnteredAt = Date.now();
let prevUrl = location.href;
let paused = false;
let eventBuffer = [];

// ── Session ID ────────────────────────────────────────────────
chrome.storage.local.get(['innergy_session_id', 'innergy_paused'], (res) => {
  sessionId = res.innergy_session_id || generateId();
  paused    = !!res.innergy_paused;
  chrome.storage.local.set({ innergy_session_id: sessionId });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.innergy_paused !== undefined) {
    paused = changes.innergy_paused.newValue;
  }
});

function generateId() {
  return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// ── Text extraction helpers ───────────────────────────────────
function bodyText() {
  return document.body?.innerText || '';
}

function extractMatches(text, re) {
  return [...new Set(text.match(re) || [])];
}

function extractStatusLabels(text) {
  const lower = text.toLowerCase();
  return STATUS_LABELS.filter((s) => lower.includes(s));
}

function extractTables() {
  const tables = [];
  document.querySelectorAll('table').forEach((tbl) => {
    const headers = [...tbl.querySelectorAll('th')].map((th) => th.innerText.trim()).filter(Boolean);
    const rows = [];
    tbl.querySelectorAll('tbody tr').forEach((tr) => {
      const cells = [...tr.querySelectorAll('td')].map((td) => td.innerText.trim());
      if (cells.some(Boolean)) {
        const row = {};
        cells.forEach((cell, i) => { row[headers[i] || `col${i}`] = cell; });
        rows.push(row);
      }
    });
    if (headers.length > 0 || rows.length > 0) {
      tables.push({ headers, row_count: rows.length, rows: rows.slice(0, 50) });
    }
  });
  return tables;
}

function extractWorkflowStage() {
  // Look for breadcrumbs, step indicators, active nav items, progress bars
  const selectors = [
    '[aria-current="step"]', '[aria-current="page"]',
    '.active', '.current-step', '.breadcrumb .active',
    '[data-step]', '.step.active', '.progress-step.active',
    'nav .active a', 'nav .selected',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.innerText?.trim()) return el.innerText.trim();
  }
  return null;
}

// ── Send event to background ──────────────────────────────────
function send(eventType, extra = {}) {
  if (paused || !sessionId) return;
  const text = bodyText();
  const event = {
    session_id:         sessionId,
    event_type:         eventType,
    page_url:           location.href,
    page_route:         location.pathname + location.search,
    page_title:         document.title,
    visible_jobs:       extractMatches(text, JOB_RE),
    visible_work_orders:extractMatches(text, WO_RE),
    visible_data: {
      dollar_amounts:  extractMatches(text, DOLLAR_RE),
      hours:           extractMatches(text, HOURS_RE),
      status_labels:   extractStatusLabels(text),
      workflow_stage:  extractWorkflowStage(),
      tables:          extractTables(),
    },
    timestamp: new Date().toISOString(),
    ...extra,
  };
  chrome.runtime.sendMessage({ type: 'INNERGY_EVENT', event });
}

// ── Page load event ───────────────────────────────────────────
function onPageLoad() {
  pageEnteredAt = Date.now();
  send('page_load');
}

// ── Click tracking ────────────────────────────────────────────
document.addEventListener('click', (e) => {
  if (paused) return;
  const target = e.target.closest('button, a, [role="tab"], [role="button"], [role="menuitem"], li, td');
  if (!target) return;
  const text   = target.innerText?.trim().slice(0, 120) || '';
  const tag    = target.tagName.toLowerCase();
  const role   = target.getAttribute('role') || '';
  const href   = target.getAttribute('href') || '';
  const elType = role || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag);
  if (!text) return;
  send('click', { click_target: `${elType}: ${text}${href ? ` [${href}]` : ''}` });
}, true);

// ── URL / navigation change detection ────────────────────────
function checkNavigation() {
  const currentUrl = location.href;
  if (currentUrl !== prevUrl) {
    const timeOnPage = Math.round((Date.now() - pageEnteredAt) / 1000);
    send('navigation', {
      click_target: JSON.stringify({ from: prevUrl, to: currentUrl }),
      time_on_page: timeOnPage,
    });
    prevUrl = currentUrl;
    pageEnteredAt = Date.now();
    // Also send page_load for the new route
    setTimeout(() => send('page_load'), 400);
  }
}

// ── MutationObserver for SPA nav ──────────────────────────────
const observer = new MutationObserver(() => {
  checkNavigation();
});
observer.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true,
});

// Also poll as a fallback (SPA frameworks sometimes replace history without DOM mutations)
setInterval(checkNavigation, 1500);

// ── Initial page load ─────────────────────────────────────────
if (document.readyState === 'complete') {
  onPageLoad();
} else {
  window.addEventListener('load', onPageLoad);
}
