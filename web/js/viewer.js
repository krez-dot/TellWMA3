// viewer.js — renders the study document inside the app so Tell can see how
// you scroll through it. PDF pages are drawn to <canvas> with pdf.js; DOCX is
// converted to HTML with mammoth. Both libraries are loaded as globals in index.html.

/* global pdfjsLib, mammoth */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdfjs/pdf.worker.min.js';

export function detectType(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (name.endsWith('.docx') || file.type.includes('wordprocessingml')) return 'docx';
  return null;
}

/**
 * Render a PDF into `container`, one canvas per page.
 * onProgress(done, total) is called after each page so the UI can show progress.
 * Returns the page count.
 */
export async function renderPdf(container, file, onProgress) {
  container.classList.remove('docx-content');
  container.innerHTML = '';

  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;

  // Render at the size it will be shown (capped at 900 CSS px), times the screen's
  // pixel density so text stays sharp on phones. CSS then scales the canvas to fit,
  // which keeps it correct after a rotation or window resize without re-rendering.
  const cssWidth = Math.min(Math.max(container.clientWidth - 24, 320), 900);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.dataset.page = i;
    canvas.setAttribute('aria-label', `Page ${i} of ${pdf.numPages}`);
    container.appendChild(canvas);

    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    onProgress?.(i, pdf.numPages);
  }
  return pdf.numPages;
}

/** Render a DOCX into `container` as HTML. */
export async function renderDocx(container, file) {
  const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  container.classList.add('docx-content');
  container.innerHTML = result.value; // mammoth output is sanitized document HTML
  return null;
}

/**
 * Which part of the document is on screen right now.
 * PDF: "Page N". DOCX has no real pages, so it is split into 10 sections by scroll position.
 */
export function currentLocation(container, type) {
  if (type === 'pdf') {
    // The page covering the upper third of the viewer is the one being read
    const y = container.scrollTop + container.clientHeight / 3;
    let page = 1;
    for (const canvas of container.querySelectorAll('canvas')) {
      if (canvas.offsetTop <= y) page = Number(canvas.dataset.page); else break;
    }
    return { key: `Page ${page}`, short: String(page) };
  }
  const scrollable = container.scrollHeight - container.clientHeight;
  const pct = scrollable > 0 ? (container.scrollTop / scrollable) * 100 : 0;
  const section = Math.min(10, Math.floor(pct / 10) + 1);
  return { key: `Section ${section}/10`, short: `${Math.round(pct)}%` };
}
