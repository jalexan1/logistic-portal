// ── pickingExcelService.js ────────────────────────────────────────────────
// Responsabilidad única: recibir los registros extraídos y generar el
// archivo Excel (.xlsx) con dos hojas: datos completos y duplicados.
// Usa la librería xlsx (SheetJS) ya instalada en el proyecto.
// No conoce React, PDF.js ni Tesseract.
// ─────────────────────────────────────────────────────────────────────────

import * as XLSX from 'xlsx';
import { detectarDuplicados } from '../utils/pickingParser';

// ── Colores (formato ARGB para SheetJS) ──────────────────────────────────
const COLOR = {
  headerBg:   '1F4E79',
  headerFont: 'FFFFFF',
  altBg:      'D6E4F0',
  dupBg:      'FFD7D7',
  warnBg:     'FFE699',
  negro:      '1A2E27',
};

const IGNORAR = new Set(['[NO LEGIBLE]', '[REVISAR - ILEGIBLE EN ESCANEO]']);

// ── Helper: estilo de celda ───────────────────────────────────────────────
function estiloHeader() {
  return {
    font:      { bold: true, color: { rgb: COLOR.headerFont }, sz: 11 },
    fill:      { fgColor: { rgb: COLOR.headerBg } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border:    bordes(),
  };
}

function estiloCelda(esDuplicado, esAdvertencia, esAlternado) {
  let bgColor = 'FFFFFF';
  if (esDuplicado)   bgColor = COLOR.dupBg;
  else if (esAdvertencia) bgColor = COLOR.warnBg;
  else if (esAlternado)   bgColor = COLOR.altBg;
  return {
    fill:      { fgColor: { rgb: bgColor } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border:    bordes(),
  };
}

function bordes() {
  const lado = { style: 'thin', color: { rgb: 'C5DDD4' } };
  return { top: lado, bottom: lado, left: lado, right: lado };
}

// ── Helper: ancho de columnas ─────────────────────────────────────────────
function setCols(ws, anchos) {
  ws['!cols'] = anchos.map(w => ({ wch: w }));
}

// ── Construye una hoja con encabezados y filas estilizadas ────────────────
function construirHoja(encabezados, filas, anchos) {
  const ws     = {};
  const rango  = { s: { r: 0, c: 0 }, e: { r: filas.length, c: encabezados.length - 1 } };

  // Encabezados
  encabezados.forEach((h, c) => {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    ws[ref] = { v: h, t: 's', s: estiloHeader() };
  });

  // Filas de datos
  filas.forEach((fila, rowIdx) => {
    const { valores, esDuplicado, esAdvertencia } = fila;
    const esAlternado = rowIdx % 2 === 1;
    valores.forEach((v, c) => {
      const ref = XLSX.utils.encode_cell({ r: rowIdx + 1, c });
      ws[ref] = {
        v: v ?? '',
        t: typeof v === 'number' ? 'n' : 's',
        s: estiloCelda(esDuplicado, esAdvertencia, esAlternado),
      };
    });
  });

  ws['!ref'] = XLSX.utils.encode_range(rango);
  setCols(ws, anchos);
  ws['!rows'] = [{ hpt: 20 }]; // altura encabezado
  return ws;
}

// ── API pública ───────────────────────────────────────────────────────────

/**
 * Genera y descarga el archivo Excel con los datos de picking extraídos.
 *
 * @param {Array<{pdfNombre:string, pagina:number, pickingNo:string, fechaImpresion:string}>} registros
 * @param {string} nombreArchivo - Nombre del archivo a descargar (sin extensión)
 */
export function generarExcelPicking(registros, nombreArchivo = 'Extraccion_Picking') {
  const { pickingsDuplicados, fechasDuplicadas } = detectarDuplicados(registros);

  const wb = XLSX.utils.book_new();

  // ── HOJA 1: Todos los datos ──────────────────────────────────────────
  const encabezados1 = ['PDF Origen', 'Página', 'Picking No', 'Fecha de Impresión', 'Nota'];

  const filas1 = registros.map(r => {
    const esDup  = pickingsDuplicados.has(r.pickingNo);
    const esWarn = IGNORAR.has(r.pickingNo) || IGNORAR.has(r.fechaImpresion) ||
                   r.fechaImpresion === '[REVISAR - ILEGIBLE EN ESCANEO]';
    let nota = '';
    if (esWarn)     nota = '⚠ Revisar escaneo';
    else if (esDup) nota = '🔁 Picking duplicado';

    return {
      valores:       [r.pdfNombre, r.pagina, r.pickingNo, r.fechaImpresion, nota],
      esDuplicado:   esDup,
      esAdvertencia: esWarn,
    };
  });

  const ws1 = construirHoja(encabezados1, filas1, [22, 9, 14, 24, 26]);
  XLSX.utils.book_append_sheet(wb, ws1, 'Datos Picking');

  // ── HOJA 2: Duplicados ───────────────────────────────────────────────
  const encabezados2 = ['PDF Origen', 'Página', 'Picking No', 'Fecha de Impresión', 'Tipo Duplicado'];

  const dupPorPicking = registros
    .filter(r => pickingsDuplicados.has(r.pickingNo))
    .sort((a, b) => a.pickingNo.localeCompare(b.pickingNo));

  const paginasYaEnDup = new Set(dupPorPicking.map(r => `${r.pdfNombre}-${r.pagina}`));

  const dupPorFecha = registros
    .filter(r => fechasDuplicadas.has(r.fechaImpresion) && !paginasYaEnDup.has(`${r.pdfNombre}-${r.pagina}`))
    .sort((a, b) => a.fechaImpresion.localeCompare(b.fechaImpresion));

  const filas2 = [
    ...dupPorPicking.map(r => ({
      valores:       [r.pdfNombre, r.pagina, r.pickingNo, r.fechaImpresion, 'Picking No repetido'],
      esDuplicado:   true,
      esAdvertencia: false,
    })),
    ...dupPorFecha.map(r => ({
      valores:       [r.pdfNombre, r.pagina, r.pickingNo, r.fechaImpresion, 'Fecha/Hora repetida'],
      esDuplicado:   false,
      esAdvertencia: true,
    })),
  ];

  if (filas2.length === 0) {
    filas2.push({
      valores:       ['Sin duplicados encontrados', '', '', '', ''],
      esDuplicado:   false,
      esAdvertencia: false,
    });
  }

  const ws2 = construirHoja(encabezados2, filas2, [22, 9, 14, 24, 22]);
  XLSX.utils.book_append_sheet(wb, ws2, 'Duplicados');

  // ── Descargar ────────────────────────────────────────────────────────
  XLSX.writeFile(wb, `${nombreArchivo}.xlsx`);
}
