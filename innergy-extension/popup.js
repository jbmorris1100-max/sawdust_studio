// ── Inline Innergy Agent — popup.js ────────────────────────────

const statusDot  = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const statusSub  = document.getElementById('statusSub');
const eventCount = document.getElementById('eventCount');
const queueCount = document.getElementById('queueCount');
const lastSync   = document.getElementById('lastSync');
const toggleBtn  = document.getElementById('toggleBtn');
const toggleIcon = document.getElementById('toggleIcon');
const toggleLabel= document.getElementById('toggleLabel');
const clearBtn   = document.getElementById('clearBtn');

function formatTime(isoStr) {
  if (!isoStr) return 'never';
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24)   return `${diffHrs}h ago`;
  return d.toLocaleDateString();
}

function applyState(paused, stats, queue, lastSyncTs) {
  const recording = !paused;

  // Dot + text
  statusDot.className  = `dot ${recording ? 'dot-green' : 'dot-red'}`;
  statusText.className = `status-text ${recording ? 'status-text-recording' : 'status-text-paused'}`;
  statusText.textContent = recording ? 'Recording' : 'Paused';
  statusSub.textContent  = recording ? 'session active' : 'monitoring paused';

  // Toggle button
  toggleIcon.textContent  = recording ? '⏸' : '▶';
  toggleLabel.textContent = recording ? 'Pause Recording' : 'Resume Recording';

  // Counters
  eventCount.textContent = (stats && stats.session) ? stats.session.toLocaleString() : '0';
  queueCount.textContent = Array.isArray(queue) ? queue.length.toLocaleString() : '0';

  // Last sync
  lastSync.textContent = formatTime(lastSyncTs);
}

function loadState() {
  chrome.storage.local.get(
    ['innergy_paused', 'innergy_stats', 'innergy_event_queue', 'innergy_last_sync'],
    (res) => {
      applyState(
        res.innergy_paused || false,
        res.innergy_stats  || {},
        res.innergy_event_queue || [],
        res.innergy_last_sync   || null,
      );
    }
  );
}

// Toggle pause/resume
toggleBtn.addEventListener('click', () => {
  chrome.storage.local.get(['innergy_paused'], (res) => {
    const newPaused = !res.innergy_paused;
    chrome.storage.local.set({ innergy_paused: newPaused }, loadState);
  });
});

// Clear session data
clearBtn.addEventListener('click', () => {
  if (!confirm('Clear all session event data? Unsynced events will be lost.')) return;
  chrome.storage.local.set(
    {
      innergy_event_queue: [],
      innergy_stats:       { total: 0, session: 0 },
      innergy_session_id:  null,
    },
    loadState
  );
});

// Initial load + auto-refresh every 3s while popup is open
loadState();
setInterval(loadState, 3000);
