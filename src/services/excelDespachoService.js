// ── excelDespachoService.js ──────────────────────────────────────────────
// Archivos que se descargan por cada solicitud (Toma de pedidos fase 3):
//   1. despacho_<AREA>_<N°>.xlsx       → plantilla completa (FECHA Y HORA + 15 campos)
//   2. CARGA A WMS_<AREA>_<N°>.xlsx    → lo que se sube al WMS (con EAN)
//   3. CARGA LIBRO 1_<AREA>_<N°>.xlsx  → una fila por ENTREGA: SKU = cuántos
//      artículos tiene la entrega, CANTIDAD = suma de unidades de la entrega.
// Todas las pantallas usan este servicio: un solo formato, un solo lugar para cambiarlo.
// Fase 6: la pantalla Despachos (radicar y "Solicitudes de hoy") descarga solo
// el Excel con el formato de la plantilla (descargarExcelPlantilla, al final).
// La pestaña Solicitudes y los bloques siguen con los 3 archivos.
// ─────────────────────────────────────────────────────────────────────────
import * as XLSX from "xlsx";
import { fechaHoraBogota } from "../utils/fechas";
import { etiquetaMotivo } from "../utils/tablaLineas";

// Columnas de la plantilla de despacho (orden pedido en DESPACHOS.xlsx,
// hoja "QUE SE DEBE SOLICITAR A CLICK", con la fecha y hora en la columna A).
export const COLUMNAS_DESPACHO = [
  { titulo: "FECHA Y HORA",        campo: "fechaHora",    ancho: 17 },
  { titulo: "AREA",                campo: "area",         ancho: 16 },
  { titulo: "SOLICITANTE",         campo: "solicitante",  ancho: 24 },
  { titulo: "CORREO ELECTRONICO",  campo: "correo",       ancho: 28 },
  { titulo: "ENTREGA",             campo: "entrega",      ancho: 16 },
  { titulo: "DESTINATARIO (NIT)",  campo: "nit",          ancho: 16 },
  { titulo: "NOMBRE DESTINATARIO", campo: "nombre",       ancho: 32 },
  { titulo: "DIRECCION",           campo: "direccion",    ancho: 28 },
  { titulo: "CIUDAD",              campo: "ciudad",       ancho: 16 },
  { titulo: "DEPARTAMENTO",        campo: "departamento", ancho: 16 },
  { titulo: "SKU",                 campo: "sku",          ancho: 16 },
  { titulo: "EAN",                 campo: "ean",          ancho: 16 },
  { titulo: "CANTIDAD",            campo: "cantidad",     ancho: 10, numero: true },
  { titulo: "UM",                  campo: "um",           ancho: 6 },
  { titulo: "ITEM",                campo: "item",         ancho: 8 },
  { titulo: "BODEGA",              campo: "bodega",       ancho: 8 },
  { titulo: "MOTIVO",              campo: "motivo",       ancho: 14 },   // 28-oct: al final
];

const COLUMNAS_WMS = [
  ["Entrega", "entrega", 16], ["Destinatario (NIT)", "nit", 16], ["Nombre destinatario", "nombre", 32],
  ["Ciudad", "ciudad", 16], ["Ean", "ean", 16], ["Cantidad entrega", "cantidad", 14],
  ["UM", "um", 6], ["item", "item", 8], ["bodega", "bodega", 8],
  ["Motivo", "motivo", 14],   // 28-oct: al final (no mueve las columnas que lee el WMS)
];

const COLUMNAS_LIBRO1 = [
  ["ENTREGA", 16], ["SKU", 8], ["CANTIDAD", 10], ["Destinatario (NIT)", 16], ["Nombre destinatario", 32],
  ["Direccion", 28], ["Telefono", 16], ["Ciudad", 16], ["Departamento", 16],
  ["Motivo", 14],             // 28-oct: al final
];

const texto = (v) => (v === null || v === undefined ? "" : String(v));
const numero = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const itemValor = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : texto(v); };

/**
 * Línea en el formato del servicio. Acepta filas de la base
 * (vw_solicitud_lineas / solicitud_lineas / vw_lote_lineas) o filas de pantalla.
 * `enc` trae lo que no está en la línea: { numero, area, solicitante, correo, radicadaAt }.
 */
export function normalizarLinea(l, enc = {}) {
  const radicadaAt = l.radicada_at || enc.radicadaAt;
  return {
    numero:       texto(l.numero || l.solicitud_numero || enc.numero),
    fechaHora:    enc.fechaHora || (radicadaAt ? fechaHoraBogota(radicadaAt) : ""),
    area:         texto(l.area_solicitante ?? enc.area),
    solicitante:  texto(l.solicitante_nombre ?? enc.solicitante),
    correo:       texto(l.solicitante_correo ?? enc.correo),
    entrega:      texto(l.entrega),
    nit:          texto(l.destinatario_nit ?? l.destinatario),
    nombre:       texto(l.destinatario_nombre ?? l.nombre),
    direccion:    texto(l.destinatario_direccion ?? l.direccion),
    ciudad:       texto(l.destinatario_ciudad ?? l.lugar),
    departamento: texto(l.destinatario_departamento ?? l.departamento),
    telefono:     texto(l.destinatario_telefono ?? l.telefono),
    sku:          texto(l.material),
    ean:          texto(l.ean),
    cantidad:     numero(l.cantidad),
    um:           texto(l.um || "BUL"),
    item:         itemValor(l.item),
    bodega:       texto(l.bodega),
    observaciones: texto(l.observaciones),
    motivo:       etiquetaMotivo(l.proceso ?? enc.proceso),
    consentimiento: l.consentimiento_at ? "Aceptado " + fechaHoraBogota(l.consentimiento_at) : "",
  };
}

// ── Hojas ────────────────────────────────────────────────────────────────
export function hojaDespacho(lineas, { conSolicitud = false, conConsentimiento = false } = {}) {
  let cols = conSolicitud
    ? [COLUMNAS_DESPACHO[0], { titulo: "N° SOLICITUD", campo: "numero", ancho: 18 }, ...COLUMNAS_DESPACHO.slice(1)]
    : COLUMNAS_DESPACHO;
  // Histórico: constancia de la alerta de inventario (al final, después de MOTIVO)
  if (conConsentimiento) cols = [...cols, { titulo: "CONSENTIMIENTO INVENTARIO", campo: "consentimiento", ancho: 26 }];
  const ws = XLSX.utils.aoa_to_sheet([cols.map(c => c.titulo), ...lineas.map(l => cols.map(c => l[c.campo]))]);
  ws["!cols"] = cols.map(c => ({ wch: c.ancho }));
  return ws;
}

export function hojaWms(lineas) {
  const ws = XLSX.utils.aoa_to_sheet([COLUMNAS_WMS.map(c => c[0]), ...lineas.map(l => COLUMNAS_WMS.map(c => l[c[1]]))]);
  ws["!cols"] = COLUMNAS_WMS.map(c => ({ wch: c[2] }));
  return ws;
}

// Una fila por ENTREGA (+ destinatario): SKU = artículos distintos, CANTIDAD = suma
export function filasLibro1(lineas) {
  const grupos = new Map();
  lineas.forEach(l => {
    const k = `${l.entrega}¦${l.nit}`;
    const g = grupos.get(k) || { ...l, skus: new Set(), total: 0 };
    g.skus.add(l.sku); g.total += l.cantidad;
    if (!g.direccion && l.direccion) g.direccion = l.direccion;
    if (!g.telefono && l.telefono) g.telefono = l.telefono;
    if (!g.departamento && l.departamento) g.departamento = l.departamento;
    grupos.set(k, g);
  });
  return [...grupos.values()].map(g => [g.entrega, g.skus.size, g.total, g.nit, g.nombre, g.direccion, g.telefono, g.ciudad, g.departamento, g.motivo]);
}

export function hojaLibro1(lineas) {
  const ws = XLSX.utils.aoa_to_sheet([COLUMNAS_LIBRO1.map(c => c[0]), ...filasLibro1(lineas)]);
  ws["!cols"] = COLUMNAS_LIBRO1.map(c => ({ wch: c[1] }));
  return ws;
}

// ── Descarga de los 3 archivos de una solicitud ─────────────────────────
const libro = (ws, nombreHoja) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, nombreHoja); return wb; };
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Descarga despacho_, CARGA A WMS_ y CARGA LIBRO 1_ de una solicitud.
 * `lineas` ya normalizadas (normalizarLinea). Se espacian las descargas para que
 * el navegador no bloquee las siguientes. Devuelve los nombres descargados.
 */
export async function descargarArchivosDespacho({ area, numero, lineas }) {
  const sufijo = `${(area || "envio").trim().replace(/\s+/g, "_")}_${numero}`;
  const archivos = [
    [`despacho_${sufijo}.xlsx`,      libro(hojaDespacho(lineas), "Plantilla")],
    [`CARGA A WMS_${sufijo}.xlsx`,   libro(hojaWms(lineas), "CARGA A WMS")],
    [`CARGA LIBRO 1_${sufijo}.xlsx`, libro(hojaLibro1(lineas), "CARGA LIBRO 1")],
  ];
  for (let i = 0; i < archivos.length; i++) {
    if (i > 0) await esperar(400);
    XLSX.writeFile(archivos[i][1], archivos[i][0]);
  }
  return archivos.map(a => a[0]);
}

// ── Excel con el formato de la plantilla (fase 6) ───────────────────────
// Pantalla Despachos (al radicar y en "Solicitudes de hoy"): el solicitante
// descarga UN solo Excel con las mismas 10 columnas de Plantilla_Pedido.xlsx,
// venga la solicitud de PDF, de la plantilla Excel o digitada a mano.
export const COLUMNAS_PLANTILLA = [
  { titulo: "Entrega",             campo: "entrega",       ancho: 16 },
  { titulo: "Nit",                 campo: "nit",           ancho: 14 },
  { titulo: "Nombre destinatario", campo: "nombre",        ancho: 34 },
  { titulo: "Direccion",           campo: "direccion",     ancho: 30 },
  { titulo: "Telefono",            campo: "telefono",      ancho: 15 },
  { titulo: "Ciudad",              campo: "ciudad",        ancho: 16 },
  { titulo: "Departamento",        campo: "departamento",  ancho: 16 },
  { titulo: "Material",            campo: "sku",           ancho: 16 },
  { titulo: "Cantidad",            campo: "cantidad",      ancho: 10, numero: true },
  { titulo: "Observaciones",       campo: "observaciones", ancho: 40 },
];

export function hojaPlantilla(lineas) {
  const ws = XLSX.utils.aoa_to_sheet([
    COLUMNAS_PLANTILLA.map(c => c.titulo),
    ...lineas.map(l => COLUMNAS_PLANTILLA.map(c => l[c.campo] ?? "")),
  ]);
  ws["!cols"] = COLUMNAS_PLANTILLA.map(c => ({ wch: c.ancho }));
  return ws;
}

/** Descarga pedido_<AREA>_<N°>.xlsx con el formato de la plantilla. `lineas` normalizadas. */
export function descargarExcelPlantilla({ area, numero, lineas }) {
  const nombre = `pedido_${(area || "envio").trim().replace(/\s+/g, "_")}_${numero}.xlsx`;
  XLSX.writeFile(libro(hojaPlantilla(lineas), "Plantilla"), nombre);
  return nombre;
}

// ── Excel de bloque / histórico: UN archivo con 4 hojas (fase 7) ─────────
//   DESPACHO · CARGA A WMS · CARGA LIBRO 1 · TABLERO CONTROL
// TABLERO CONTROL: una fila por línea del pedido (FACTURA = Entrega).
const COLUMNAS_TABLERO = [
  ["FECHA Y HORA", "fechaHora", 17], ["FACTURA", "entrega", 16], ["NIT", "nit", 14],
  ["NOMBRE", "nombre", 32], ["SKU", "sku", 16], ["CANTIDAD", "cantidad", 10],
  ["DIRECCION", "direccion", 30], ["TELEFONO", "telefono", 15], ["CIUDAD", "ciudad", 16],
  ["DEPARTAMENTO", "departamento", 16], ["MOTIVO", "motivo", 14],   // 28-oct: al final
];
export function hojaTablero(lineas) {
  const ws = XLSX.utils.aoa_to_sheet([COLUMNAS_TABLERO.map(c => c[0]), ...lineas.map(l => COLUMNAS_TABLERO.map(c => l[c[1]] ?? ""))]);
  ws["!cols"] = COLUMNAS_TABLERO.map(c => ({ wch: c[2] }));
  return ws;
}

/** Libro con las 4 hojas a partir de líneas de la base (vw_lote_lineas / vw_solicitud_lineas). */
export function libroBloque(lineasBase, { conConsentimiento = false } = {}) {
  const lineas = lineasBase.map(l => normalizarLinea(l));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaDespacho(lineas, { conSolicitud: true, conConsentimiento }), "DESPACHO");
  XLSX.utils.book_append_sheet(wb, hojaWms(lineas), "CARGA A WMS");
  XLSX.utils.book_append_sheet(wb, hojaLibro1(lineas), "CARGA LIBRO 1");
  XLSX.utils.book_append_sheet(wb, hojaTablero(lineas), "TABLERO CONTROL");
  return wb;
}

/** despachos_bloque_<LOT>.xlsx (mismo nombre de siempre). */
export function descargarExcelBloque(numeroLote, lineasBase) {
  const nombre = `despachos_bloque_${numeroLote}.xlsx`;
  XLSX.writeFile(libroBloque(lineasBase), nombre);
  return nombre;
}
