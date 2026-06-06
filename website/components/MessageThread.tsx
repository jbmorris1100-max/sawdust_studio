'use client';
import { useEffect, useRef, useState } from 'react';

// ── MessageThread ─────────────────────────────────────────────────────────────
// iMessage-style conversation view shared by the supervisor and crew pages.
// "Self" bubbles are right-aligned teal; the other party's are left-aligned grey.
// Sender name shows above the first bubble of a sequence; relative timestamp below
// the last; a tail marks the end of each sequence. Input is pinned to the bottom,
// grows up to ~4 lines, sends on Enter (Shift+Enter = newline), clears after send.

export type ThreadMsg = {
  id: string;
  sender_name: string;
  dept: string | null;
  body: string;
  created_at: string;
};

function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours} hr${hours !== 1 ? 's' : ''} ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const SELF_BG  = '#2DE1C9';
const OTHER_BG = '#26292e';

export default function MessageThread({
  messages,
  selfKind,
  onSend,
  sending = false,
  placeholder = 'Message',
}: {
  messages: ThreadMsg[];                 // oldest-first
  selfKind: 'supervisor' | 'crew';
  onSend: (text: string) => void | Promise<void>;
  sending?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const isSelf = (m: ThreadMsg) =>
    selfKind === 'supervisor' ? m.sender_name === 'Supervisor' : m.sender_name !== 'Supervisor';

  // Smooth-scroll the thread (not the page) to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  // Auto-grow the textarea up to 4 lines, then scroll internally.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const max = 22 * 4 + 20; // ~4 lines + padding
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
  }, [text]);

  function submit() {
    const t = text.trim();
    if (!t || sending) return;
    void onSend(t);
    setText('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflowX: 'hidden', maxWidth: '100%' }}>
      <div
        ref={scrollRef}
        style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: '60vh', overflowY: 'auto', overflowX: 'hidden', maxWidth: '100%', paddingLeft: 6, paddingRight: 6, paddingBottom: 8 }}
      >
        {messages.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink-mute)', padding: '12px 0' }}>No messages yet.</div>
        ) : (
          messages.map((m, i) => {
            const self = isSelf(m);
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const firstOfSeq = !prev || prev.sender_name !== m.sender_name;
            const lastOfSeq  = !next || next.sender_name !== m.sender_name;
            return (
              <div
                key={m.id}
                style={{ display: 'flex', flexDirection: 'column', alignItems: self ? 'flex-end' : 'flex-start', marginTop: firstOfSeq ? 12 : 2, maxWidth: '100%' }}
              >
                {firstOfSeq && !self && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-mute)', margin: '0 13px 3px' }}>{m.sender_name}</span>
                )}
                <div
                  style={{
                    position: 'relative', maxWidth: '70%', padding: '8px 13px',
                    borderRadius: 18, background: self ? SELF_BG : OTHER_BG, color: self ? '#04201c' : '#fff',
                    fontSize: 14.5, lineHeight: 1.4, wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
                    borderBottomRightRadius: self && lastOfSeq ? 5 : 18,
                    borderBottomLeftRadius: !self && lastOfSeq ? 5 : 18,
                    opacity: m.id.startsWith('opt-') ? 0.6 : 1,
                  }}
                >
                  {m.body}
                  {/* One tail per sequence, on the last bubble (iMessage convention) */}
                  {lastOfSeq && (
                    <span
                      style={self
                        ? { position: 'absolute', right: -5, bottom: 0, width: 0, height: 0, borderTop: `10px solid ${SELF_BG}`, borderRight: '7px solid transparent' }
                        : { position: 'absolute', left: -5, bottom: 0, width: 0, height: 0, borderTop: `10px solid ${OTHER_BG}`, borderLeft: '7px solid transparent' }}
                    />
                  )}
                </div>
                {lastOfSeq && (
                  <span style={{ fontSize: 10.5, color: 'var(--ink-mute)', margin: '3px 13px 0' }}>{relTime(m.created_at)}</span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pinned input bar */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, paddingTop: 12, marginTop: 4, borderTop: '1px solid var(--line)', maxWidth: '100%' }}>
        <textarea
          ref={taRef}
          value={text}
          rows={1}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          style={{ flex: 1, minWidth: 0, resize: 'none', maxHeight: 108, padding: '10px 15px', borderRadius: 20, border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--ink)', fontSize: 14.5, fontFamily: 'inherit', lineHeight: '22px', outline: 'none' }}
        />
        <button
          onClick={submit}
          disabled={!text.trim() || sending}
          aria-label="Send"
          style={{ flexShrink: 0, width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: (!text.trim() || sending) ? 'default' : 'pointer', background: (!text.trim() || sending) ? 'var(--line)' : SELF_BG, color: '#04201c', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
