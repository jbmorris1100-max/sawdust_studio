'use client';
/* ============================================================================
 * FileViewer — universal inline file viewer
 * ----------------------------------------------------------------------------
 * Renders every supported file type inside the app. No downloads required, no
 * new tabs, no Excel. PDF.js is loaded on demand from cdnjs (no bundled dep).
 *
 * Supported: PDF · CSV (grouped / raw) · image · XML/JSON tree · DXF · unknown
 *
 * Usage:
 *   <FileViewer file={{ url, name, jobPath, fileType, parsed, cabinets }}
 *               onClose={() => setOpen(false)} />
 * ========================================================================== */
import { useEffect, useRef, useState, useCallback } from 'react';

/* ---- types --------------------------------------------------------------- */
export type ViewerPart = {
  part_name: string;
  width?: number | null;
  height?: number | null;
  depth?: number | null;
  material?: string | null;
  quantity?: number | null;
};
export type ViewerCabinet = {
  id: string;
  unit_label: string;          // "K01 — Sink Base 36\""
  room?: string | null;        // "Room 1"
  parts: ViewerPart[];
};
export type ViewerFile = {
  url: string;
  name: string;
  jobPath?: string;            // "Smith/Kitchen/Drawings"
  fileType?: string | null;    // hint: 'pdf' | 'csv' | 'image' | ...
  parsed?: boolean;            // CSV: render grouped cabinet view
  cabinets?: ViewerCabinet[];  // grouped data (parsed CSVs)
  sizeBytes?: number | null;
};

/* ---- format detection ---------------------------------------------------- */
type Kind = 'pdf' | 'csv' | 'image' | 'svg' | 'html' | 'xml' | 'json' | 'dxf' | 'spreadsheet' | 'unknown';
function detectKind(file: ViewerFile): Kind {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const t = (file.fileType ?? '').toLowerCase();
  if (t === 'pdf' || ext === 'pdf') return 'pdf';
  if (t === 'csv' || ext === 'csv') return 'csv';
  if (t === 'svg' || ext === 'svg') return 'svg';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext) || t === 'image') return 'image';
  if (t === 'html' || ext === 'html' || ext === 'htm') return 'html';
  if (t === 'spreadsheet' || ['xlsx', 'xls', 'xlsm'].includes(ext)) return 'spreadsheet';
  if (ext === 'json' || t === 'json') return 'json';
  if (ext === 'xml' || t === 'xml') return 'xml';
  if (ext === 'dxf' || t === 'dxf') return 'dxf';
  return 'unknown';
}

/* ---- thin-stroke SVG icons (no emoji) ------------------------------------ */
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const IconX = () => (<svg width="20" height="20" viewBox="0 0 24 24" {...stroke}><path d="M6 6l12 12M18 6L6 18" /></svg>);
const IconDownload = () => (<svg width="18" height="18" viewBox="0 0 24 24" {...stroke}><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" /></svg>);
const IconGroup = () => (<svg width="16" height="16" viewBox="0 0 24 24" {...stroke}><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /></svg>);
const IconRows = () => (<svg width="16" height="16" viewBox="0 0 24 24" {...stroke}><path d="M4 7h16M4 12h16M4 17h16" /></svg>);
const IconChevron = ({ open }: { open: boolean }) => (<svg width="16" height="16" viewBox="0 0 24 24" {...stroke} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6" /></svg>);

/* ---- shared download helper --------------------------------------------- */
function DownloadButton({ url, name }: { url: string; name: string }) {
  return (
    <a href={url} download={name} target="_blank" rel="noopener noreferrer"
       title="Download" aria-label="Download"
       style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 9, background: 'rgba(255,255,255,0.06)', color: 'var(--ink-dim)', border: '1px solid rgba(255,255,255,0.1)' }}>
      <IconDownload />
    </a>
  );
}

/* ========================================================================== *
 *  PDF VIEWER  (pdf.js via cdnjs — loaded once, cached on window)
 * ========================================================================== */
const PDFJS_VERSION = '3.11.174';
const PDFJS_SRC    = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function loadPdfJs(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  const w = window as any;
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  if (w.__pdfjsLoading) return w.__pdfjsLoading;
  w.__pdfjsLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_SRC;
    s.onload = () => {
      const lib = (window as any).pdfjsLib;
      if (lib) { lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; resolve(lib); }
      else reject(new Error('pdf.js failed to expose pdfjsLib'));
    };
    s.onerror = () => reject(new Error('pdf.js script failed to load'));
    document.head.appendChild(s);
  });
  return w.__pdfjsLoading;
}

function PdfView({ url }: { url: string }) {
  const [pdf, setPdf] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [error, setError] = useState<string | null>(null);
  const [thumbsOpen, setThumbsOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const renderTask = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    loadPdfJs()
      .then((lib) => lib.getDocument(url).promise)
      .then((doc: any) => { if (!cancelled) { setPdf(doc); setNumPages(doc.numPages); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [url]);

  // Render the main page
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    pdf.getPage(page).then((pg: any) => {
      if (cancelled) return;
      const viewport = pg.getViewport({ scale });
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      if (renderTask.current) { try { renderTask.current.cancel(); } catch { /* noop */ } }
      renderTask.current = pg.render({ canvasContext: ctx, viewport });
    });
    return () => { cancelled = true; };
  }, [pdf, page, scale]);

  // Render thumbnails when the strip is open
  useEffect(() => {
    if (!pdf || !thumbsOpen) return;
    let cancelled = false;
    (async () => {
      for (let p = 1; p <= numPages; p++) {
        const c = pageRefs.current[p];
        if (!c || cancelled) continue;
        const pg = await pdf.getPage(p);
        const vp = pg.getViewport({ scale: 0.18 });
        c.width = vp.width; c.height = vp.height;
        pg.render({ canvasContext: c.getContext('2d')!, viewport: vp });
      }
    })();
    return () => { cancelled = true; };
  }, [pdf, thumbsOpen, numPages]);

  if (error) {
    return <div style={{ padding: 40, color: 'var(--ink-mute)', textAlign: 'center' }}>
      Could not render PDF inline ({error}). Use the download button to open it.
    </div>;
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* thumbnail strip */}
      <div style={{ width: thumbsOpen ? 132 : 40, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.08)', overflowY: 'auto', background: 'rgba(0,0,0,0.25)', transition: 'width .18s' }}>
        <button onClick={() => setThumbsOpen((v) => !v)}
          style={{ width: '100%', padding: '10px 0', background: 'none', border: 'none', color: 'var(--ink-mute)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
          {thumbsOpen ? '‹ Pages' : '☰'}
        </button>
        {thumbsOpen && Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
          <button key={p} onClick={() => setPage(p)}
            style={{ display: 'block', width: '100%', padding: 6, background: p === page ? 'rgba(94,234,212,0.12)' : 'none', border: 'none', cursor: 'pointer' }}>
            <canvas ref={(el) => { pageRefs.current[p] = el; }} style={{ width: '100%', borderRadius: 3, border: p === page ? '1.5px solid var(--teal)' : '1px solid rgba(255,255,255,0.1)' }} />
            <div style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 2 }}>{p}</div>
          </button>
        ))}
      </div>

      {/* main page */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 16, minWidth: 0 }}>
        <canvas ref={canvasRef} style={{ maxWidth: '100%', borderRadius: 4, boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }} />
      </div>

      {/* controls */}
      <div style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 999, background: 'rgba(10,13,16,0.92)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)' }}>
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={ctrlBtn}>‹</button>
        <span style={{ fontSize: 12, color: 'var(--ink-dim)', minWidth: 92, textAlign: 'center' }}>Page {page} of {numPages || '…'}</span>
        <button onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages} style={ctrlBtn}>›</button>
        <span style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.15)' }} />
        <button onClick={() => setScale((s) => Math.max(0.5, s - 0.2))} style={ctrlBtn}>−</button>
        <button onClick={() => setScale((s) => Math.min(3, s + 0.2))} style={ctrlBtn}>+</button>
      </div>
    </div>
  );
}
const ctrlBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 7, background: 'rgba(255,255,255,0.06)', color: 'var(--ink)', border: 'none', cursor: 'pointer', fontSize: 16, fontFamily: 'inherit' };

/* ========================================================================== *
 *  CSV VIEWER  (grouped cabinet cards  ·  raw table)
 * ========================================================================== */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
  const split = (line: string): string[] => {
    const out: string[] = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur); return out.map((s) => s.trim());
  };
  if (lines.length === 0) return { headers: [], rows: [] };
  return { headers: split(lines[0]), rows: lines.slice(1).map(split) };
}

function CsvView({ file }: { file: ViewerFile }) {
  const canGroup = !!file.parsed && !!file.cabinets && file.cabinets.length > 0;
  const [mode, setMode] = useState<'grouped' | 'raw'>(canGroup ? 'grouped' : 'raw');
  const [raw, setRaw] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const loading = mode === 'raw' && !raw;

  useEffect(() => {
    if (mode !== 'raw' || raw) return;
    let cancelled = false;
    fetch(file.url).then((r) => r.text())
      .then((t) => { if (!cancelled) setRaw(parseCsv(t)); })
      .catch(() => { if (!cancelled) setRaw({ headers: [], rows: [] }); });
    return () => { cancelled = true; };
  }, [mode, raw, file.url]);

  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  const dims = (p: ViewerPart) => [p.width, p.height, p.depth].filter((d) => d != null).join(' × ');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {canGroup && (
        <div style={{ display: 'flex', gap: 6, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <button onClick={() => setMode('grouped')} style={toggleBtn(mode === 'grouped')}><IconGroup /> Grouped</button>
          <button onClick={() => setMode('raw')} style={toggleBtn(mode === 'raw')}><IconRows /> Raw</button>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: 16, minHeight: 0 }}>
        {mode === 'grouped' && canGroup && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720, margin: '0 auto' }}>
            {file.cabinets!.map((cab) => {
              const open = expanded[cab.id] ?? false;
              return (
                <div key={cab.id} style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-1)' }}>
                  <button onClick={() => toggle(cab.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{cab.unit_label}</div>
                      {cab.room && <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>{cab.room}</div>}
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{cab.parts.length} part{cab.parts.length === 1 ? '' : 's'}</span>
                    <IconChevron open={open} />
                  </button>
                  {open && (
                    <div style={{ padding: '4px 14px 10px' }}>
                      {cab.parts.map((p, i) => (
                        <div key={i} style={{ padding: '9px 0', borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-dim)' }}>
                            {p.part_name}{p.quantity && p.quantity > 1 ? ` ×${p.quantity}` : ''}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>
                            {dims(p)}{p.material ? `${dims(p) ? ' — ' : ''}${p.material}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {mode === 'raw' && (
          loading ? <div style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: 40 }}>Loading…</div>
          : !raw || raw.headers.length === 0 ? <div style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: 40 }}>Empty file.</div>
          : (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 'max-content' }}>
                <thead>
                  <tr>{raw.headers.map((h, i) => (
                    <th key={i} style={{ position: 'sticky', top: 0, background: 'var(--bg-2)', color: 'var(--teal)', textAlign: 'left', padding: '8px 12px', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {raw.rows.map((row, r) => (
                    <tr key={r} style={{ background: r % 2 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                      {raw.headers.map((_, c) => (
                        <td key={c} style={{ padding: '7px 12px', color: 'var(--ink-dim)', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{row[c] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
const toggleBtn = (active: boolean): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid', borderColor: active ? 'var(--teal-dim)' : 'rgba(255,255,255,0.1)', background: active ? 'rgba(94,234,212,0.1)' : 'transparent', color: active ? 'var(--teal)' : 'var(--ink-mute)' });

/* ========================================================================== *
 *  IMAGE VIEWER  (pinch / double-tap zoom, full-screen)
 * ========================================================================== */
function ImageView({ url }: { url: string }) {
  const [zoom, setZoom] = useState(1);
  return (
    <div onDoubleClick={() => setZoom((z) => (z === 1 ? 2.2 : 1))}
      style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', background: '#000', touchAction: 'pinch-zoom' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" style={{ maxWidth: zoom === 1 ? '100%' : 'none', maxHeight: zoom === 1 ? '100%' : 'none', transform: `scale(${zoom})`, transition: 'transform .2s', transformOrigin: 'center' }} />
    </div>
  );
}

/* ========================================================================== *
 *  SVG VIEWER  (vector plans — rendered on white so dark strokes stay visible)
 * ========================================================================== */
function SvgView({ url }: { url: string }) {
  const [zoom, setZoom] = useState(1);
  return (
    <div onDoubleClick={() => setZoom((z) => (z === 1 ? 2.2 : 1))}
      style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', background: '#fff', touchAction: 'pinch-zoom' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" style={{ maxWidth: zoom === 1 ? '100%' : 'none', maxHeight: zoom === 1 ? '100%' : 'none', transform: `scale(${zoom})`, transition: 'transform .2s', transformOrigin: 'center' }} />
    </div>
  );
}

/* ========================================================================== *
 *  HTML VIEWER  (sandboxed — no script execution, no same-origin access)
 * ========================================================================== */
function HtmlView({ url, name }: { url: string; name: string }) {
  return (
    <iframe
      src={url}
      title={name}
      sandbox=""
      referrerPolicy="no-referrer"
      style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
    />
  );
}

/* ========================================================================== *
 *  XML / JSON TREE VIEWER
 * ========================================================================== */
function JsonNode({ k, v, depth }: { k: string | null; v: unknown; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const isObj = v !== null && typeof v === 'object';
  const keyStyle: React.CSSProperties = { color: 'var(--teal)' };
  const valStyle: React.CSSProperties = { color: 'var(--ink)' };
  if (!isObj) {
    return <div style={{ paddingLeft: depth * 14, fontSize: 12.5, fontFamily: 'ui-monospace, monospace', lineHeight: 1.7 }}>
      {k !== null && <span style={keyStyle}>{k}: </span>}
      <span style={valStyle}>{typeof v === 'string' ? `"${v}"` : String(v)}</span>
    </div>;
  }
  const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as [string, unknown]) : Object.entries(v as object);
  return (
    <div style={{ paddingLeft: depth * 14, fontSize: 12.5, fontFamily: 'ui-monospace, monospace', lineHeight: 1.7 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--ink-mute)', fontFamily: 'inherit', fontSize: 12.5 }}>
        {open ? '▾' : '▸'} {k !== null && <span style={keyStyle}>{k}</span>}{' '}
        <span style={{ color: 'var(--ink-mute)' }}>{Array.isArray(v) ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </button>
      {open && entries.map(([ck, cv]) => <JsonNode key={ck} k={ck} v={cv} depth={depth + 1} />)}
    </div>
  );
}
function StructuredView({ url, kind }: { url: string; kind: 'json' | 'xml' }) {
  const [data, setData] = useState<unknown>(undefined);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch(url).then((r) => r.text()).then((t) => {
      if (kind === 'json') { setData(JSON.parse(t)); return; }
      const doc = new DOMParser().parseFromString(t, 'application/xml');
      const toObj = (node: Element): unknown => {
        const children = Array.from(node.children);
        if (children.length === 0) return node.textContent;
        const o: Record<string, unknown> = {};
        for (const c of children) {
          const val = toObj(c);
          if (o[c.tagName] === undefined) o[c.tagName] = val;
          else { if (!Array.isArray(o[c.tagName])) o[c.tagName] = [o[c.tagName]]; (o[c.tagName] as unknown[]).push(val); }
        }
        return o;
      };
      setData({ [doc.documentElement.tagName]: toObj(doc.documentElement) });
    }).catch((e) => setErr(String(e)));
  }, [url, kind]);
  if (err) return <div style={{ padding: 40, color: 'var(--ink-mute)' }}>Could not parse {kind.toUpperCase()}: {err}</div>;
  if (data === undefined) return <div style={{ padding: 40, color: 'var(--ink-mute)' }}>Loading…</div>;
  return <div style={{ padding: 16, overflow: 'auto', height: '100%' }}><JsonNode k={null} v={data} depth={0} /></div>;
}

/* ========================================================================== *
 *  DXF / UNKNOWN — info card + download
 * ========================================================================== */
function fmtSize(b?: number | null): string {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
function InfoView({ file, kind }: { file: ViewerFile; kind: Kind }) {
  const note = kind === 'dxf'
    ? 'Open in your CAD app to view. (Inline SVG rendering coming in a future update.)'
    : kind === 'spreadsheet'
    ? 'Spreadsheet files open in Excel, Numbers, or Google Sheets. Download to view, or upload as CSV to preview inline.'
    : 'This file type opens in an external app.';
  const title = kind === 'dxf' ? `DXF file — ${file.name}`
    : kind === 'spreadsheet' ? `Spreadsheet — ${file.name}`
    : file.name;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, textAlign: 'center' }}>
      <svg width="56" height="56" viewBox="0 0 24 24" {...stroke}><path d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /></svg>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{title}</div>
      {file.sizeBytes ? <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{fmtSize(file.sizeBytes)}</div> : null}
      <div style={{ fontSize: 13, color: 'var(--ink-mute)', maxWidth: 320 }}>{note}</div>
      <a href={file.url} download={file.name} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ marginTop: 4 }}>Download</a>
    </div>
  );
}

/* ========================================================================== *
 *  CONTAINER  — full-screen overlay (modal on desktop, sheet on mobile)
 * ========================================================================== */
export default function FileViewer({ file, onClose }: { file: ViewerFile; onClose: () => void }) {
  const kind = detectKind(file);

  // Esc to close + lock body scroll while open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const prettyPath = file.jobPath ? file.jobPath.split('/').join(' / ') : null;

  const body = useCallback(() => {
    switch (kind) {
      case 'pdf':   return <PdfView url={file.url} />;
      case 'csv':   return <CsvView file={file} />;
      case 'image': return <ImageView url={file.url} />;
      case 'svg':   return <SvgView url={file.url} />;
      case 'html':  return <HtmlView url={file.url} name={file.name} />;
      case 'json':  return <StructuredView url={file.url} kind="json" />;
      case 'xml':   return <StructuredView url={file.url} kind="xml" />;
      default:      return <InfoView file={file} kind={kind} />;
    }
  }, [kind, file]);

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} className="fileviewer-shell"
        style={{
          position: 'relative', display: 'flex', flexDirection: 'column',
          background: 'var(--bg)', border: '1px solid rgba(255,255,255,0.1)',
          width: 'min(1100px, 100%)', height: 'min(92vh, 100%)',
          borderRadius: 14, overflow: 'hidden',
          animation: 'fv-up .22s cubic-bezier(.2,.8,.2,1)',
          paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          <button onClick={onClose} aria-label="Close" title="Close"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 9, background: 'rgba(255,255,255,0.06)', color: 'var(--ink-dim)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', flexShrink: 0 }}>
            <IconX />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</div>
            {prettyPath && <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>{prettyPath}</div>}
          </div>
          <DownloadButton url={file.url} name={file.name} />
        </div>
        {/* body */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{body()}</div>
      </div>

      <style>{`
        @keyframes fv-up { from { transform: translateY(24px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        @media (max-width: 768px) {
          .fileviewer-shell {
            width: 100% !important; height: 100% !important;
            border-radius: 0 !important; border: none !important;
            animation: fv-sheet .26s cubic-bezier(.2,.8,.2,1) !important;
          }
        }
        @keyframes fv-sheet { from { transform: translateY(100%) } to { transform: translateY(0) } }
      `}</style>
    </div>
  );
}
