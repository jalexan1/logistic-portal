// ── pickingParser.js ──────────────────────────────────────────────────────
// Responsabilidad única: extraer campos Picking No y Fecha de Impresión
// del texto OCR de una página. No conoce PDF.js ni Tesseract ni Excel.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extrae el número de Picking del texto OCR de una página.
 * @param {string} text - Texto completo OCR de la página
 * @returns {string} Número encontrado o '[NO LEGIBLE]'
 */
export function extraerPickingNo(text) {
  const match = text.match(/Picking\s*No[\.:]?\s*(\d{4,6})/i);
  return match ? match[1] : '[NO LEGIBLE]';
}

/**
 * Extrae la Fecha de Impresión del texto OCR de una página.
 * @param {string} text - Texto completo OCR de la página
 * @returns {string} Fecha en formato YYYY-MM-DD HH:MM:SS o '[NO LEGIBLE]'
 */
export function extraerFechaImpresion(text) {
  const match = text.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  if (!match) return '[NO LEGIBLE]';

  // Validar que sea una fecha/hora real (hora 0-23, min/seg 0-59)
  const partes = match[1].match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!partes) return '[NO LEGIBLE]';
  const [, , hh, mm, ss] = partes;
  if (parseInt(hh) > 23 || parseInt(mm) > 59 || parseInt(ss) > 59) {
    return '[REVISAR - ILEGIBLE EN ESCANEO]';
  }
  return match[1];
}

/**
 * Analiza el conjunto completo de resultados y detecta duplicados.
 * @param {Array<{pdfNombre, pagina, pickingNo, fechaImpresion}>} registros
 * @returns {{ pickingsDuplicados: Set<string>, fechasDuplicadas: Set<string> }}
 */
export function detectarDuplicados(registros) {
  const IGNORAR = new Set(['[NO LEGIBLE]', '[REVISAR - ILEGIBLE EN ESCANEO]']);

  const contPicking = {};
  const contFecha   = {};

  registros.forEach(({ pickingNo, fechaImpresion }) => {
    if (!IGNORAR.has(pickingNo)) {
      contPicking[pickingNo] = (contPicking[pickingNo] || 0) + 1;
    }
    if (!IGNORAR.has(fechaImpresion)) {
      contFecha[fechaImpresion] = (contFecha[fechaImpresion] || 0) + 1;
    }
  });

  return {
    pickingsDuplicados: new Set(Object.keys(contPicking).filter(k => contPicking[k] > 1)),
    fechasDuplicadas:   new Set(Object.keys(contFecha).filter(k => contFecha[k] > 1)),
  };
}
