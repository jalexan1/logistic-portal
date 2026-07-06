// ── pdfOcrService.js ──────────────────────────────────────────────────────
// Responsabilidad única: dado un File PDF, entregar el texto OCR de cada
// página. No conoce React, no genera Excel, no parsea campos de negocio.
//
// Usa PDF.js (cargado desde CDN) para renderizar cada página a canvas,
// y Tesseract.js (CDN) para hacer OCR sobre esa imagen.
// ─────────────────────────────────────────────────────────────────────────

const PDFJS_CDN     = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

// ── Carga dinámica de scripts externos ──────────────────────────────────
function cargarScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload  = resolve;
    s.onerror = () => reject(new Error(`No se pudo cargar: ${src}`));
    document.head.appendChild(s);
  });
}

let _pdfjsReady     = false;
let _tesseractReady = false;

async function asegurarPdfJs() {
  if (_pdfjsReady) return;
  await cargarScript(PDFJS_CDN);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  _pdfjsReady = true;
}

async function asegurarTesseract() {
  if (_tesseractReady) return;
  await cargarScript(TESSERACT_CDN);
  _tesseractReady = true;
}

// ── Renderiza una página PDF en un canvas y devuelve ImageData URL ───────
async function paginaAImagenUrl(pdfDoc, numeroPagina, escala = 1.8) {
  const pagina  = await pdfDoc.getPage(numeroPagina);
  const viewport = pagina.getViewport({ scale: escala });

  const canvas  = document.createElement('canvas');
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  const ctx     = canvas.getContext('2d');

  await pagina.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}

// ── Detecta si la imagen requiere rotación (paisaje → portrait) ──────────
function necesitaRotacion(canvas) {
  return canvas.width > canvas.height;
}

// ── OCR de una imagen (dataURL) ──────────────────────────────────────────
async function ocr(imageUrl) {
  const worker = await window.Tesseract.createWorker('eng');
  const { data: { text } } = await worker.recognize(imageUrl);
  await worker.terminate();
  return text;
}

// ── API pública ───────────────────────────────────────────────────────────

/**
 * Procesa un archivo PDF y llama onPagina por cada página procesada.
 *
 * @param {File}     archivo    - Objeto File del PDF
 * @param {Function} onPagina   - Callback({ pagina, total, texto })
 * @param {Function} onProgreso - Callback(mensaje: string)
 * @returns {Promise<Array<{pagina, texto}>>}
 */
export async function procesarPdf(archivo, onPagina, onProgreso) {
  await asegurarPdfJs();
  await asegurarTesseract();

  onProgreso?.('Leyendo PDF…');
  const arrayBuffer = await archivo.arrayBuffer();
  const pdfDoc      = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const total       = pdfDoc.numPages;

  const resultados = [];

  for (let i = 1; i <= total; i++) {
    onProgreso?.(`Procesando página ${i} de ${total}…`);

    // Renderizar página a canvas
    const pagina   = await pdfDoc.getPage(i);
    const escala   = 1.8;
    const viewport = pagina.getViewport({ scale: escala });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    const ctx      = canvas.getContext('2d');
    await pagina.render({ canvasContext: ctx, viewport }).promise;

    // Rotar si es apaisado (como el PICKING MAYO.pdf)
    let imageUrl;
    if (canvas.width > canvas.height) {
      const rotado    = document.createElement('canvas');
      rotado.width    = canvas.height;
      rotado.height   = canvas.width;
      const rCtx      = rotado.getContext('2d');
      rCtx.translate(rotado.width / 2, rotado.height / 2);
      rCtx.rotate(Math.PI / 2);
      rCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      imageUrl = rotado.toDataURL('image/png');
    } else {
      imageUrl = canvas.toDataURL('image/png');
    }

    const texto = await ocr(imageUrl);
    const resultado = { pagina: i, total, texto };
    resultados.push(resultado);
    onPagina?.(resultado);
  }

  return resultados;
}
