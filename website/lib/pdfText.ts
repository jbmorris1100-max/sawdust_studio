// Client-only PDF text extraction via pdf.js (cdnjs, same version FileViewer uses).
// Used by the Plans upload flow to pull text for document classification and
// cabinet-roster extraction. Browser-only: getTextContent runs without a canvas.
/* eslint-disable @typescript-eslint/no-explicit-any */

const PDFJS_VERSION = '3.11.174';
const PDFJS_SRC    = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

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

// Join one page's text items into a single string.
async function pageText(pg: any): Promise<string> {
  const content = await pg.getTextContent();
  return (content.items as { str: string }[]).map((i) => i.str).join(' ');
}

export type PdfText = { firstPageText: string; fullText: string; pageCount: number };

// Extract text from an uploaded PDF File. firstPageText drives classification;
// fullText (up to `maxPages`) drives roster extraction. Never throws — returns
// empty text on any failure so the caller can fall back to 'unparseable'.
export async function extractPdfText(file: File, maxPages = 20): Promise<PdfText> {
  try {
    const buf = await file.arrayBuffer();
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: buf }).promise;
    const pageCount: number = doc.numPages;
    const first = await pageText(await doc.getPage(1));
    const parts: string[] = [first];
    const limit = Math.min(pageCount, maxPages);
    for (let p = 2; p <= limit; p++) {
      try { parts.push(await pageText(await doc.getPage(p))); } catch { /* skip page */ }
    }
    return { firstPageText: first, fullText: parts.join('\n'), pageCount };
  } catch {
    return { firstPageText: '', fullText: '', pageCount: 0 };
  }
}
