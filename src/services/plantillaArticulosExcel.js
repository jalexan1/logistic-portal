// ── plantillaArticulosExcel.js ───────────────────────────────────────────
// Plantilla de carga masiva de artículos (Maestros → Artículos).
// Columnas: ITEM | EAN | DESCRIPCION
// El ITEM y el EAN se leen como TEXTO aunque Excel los guarde como número
// (evita 7,70927E+12 y ceros perdidos). Quita espacios del ITEM y del EAN.
// ─────────────────────────────────────────────────────────────────────────
import * as XLSX from "xlsx";

export const COLUMNAS_PLANTILLA_ARTICULOS = ["ITEM", "EAN", "DESCRIPCION"];

const norm = (v) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const ENCABEZADOS = {
  item:        ["item", "sku", "codigo", "codigo item", "item sku", "material", "referencia"],
  ean:         ["ean", "codigo ean", "ean13", "codigo de barras", "codigo barras"],
  descripcion: ["descripcion", "descripcion item", "producto", "nombre", "nombre producto"],
};

// Número de Excel → texto sin notación científica ni decimales (7709268279632, no 7.70927E+12)
const comoTexto = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v).replace(/[\s\u00a0]+/g, " ").trim();
};

/** Descarga la plantilla vacía con una fila de ejemplo y una hoja de instrucciones. */
export function descargarPlantillaArticulos() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([COLUMNAS_PLANTILLA_ARTICULOS, ["PTC9121", "7709268279632", "TERMOPROTECTOR BIFÁSICO"]]);
  // ITEM y EAN como texto para que Excel no los convierta a número
  ["A2", "B2"].forEach(ref => { if (ws[ref]) { ws[ref].t = "s"; ws[ref].z = "@"; } });
  ws["!cols"] = [{ wch: 16 }, { wch: 18 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(wb, ws, "Articulos");
  const ins = XLSX.utils.aoa_to_sheet([
    ["Instrucciones para la carga masiva de artículos"], [],
    ["Columna", "Obligatoria", "Notas"],
    ["ITEM", "Sí", "Código del ítem / SKU (ej. PTC9121). Es la llave: si ya existe, se actualiza con el EAN y la descripción del archivo."],
    ["EAN", "Sí", "Código de barras. Si ya está asignado a OTRO ítem activo, la fila no se carga y sale en el reporte."],
    ["DESCRIPCION", "No", "Si viene vacía y el ítem ya existe, se conserva la descripción actual."],
    [], ["Formatee las columnas ITEM y EAN como TEXTO en Excel para no perder ceros."],
    ["Borre la fila de ejemplo antes de cargar. La carga se puede repetir: no duplica artículos."],
  ]);
  ins["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, ins, "Instrucciones");
  XLSX.writeFile(wb, "Plantilla_Articulos.xlsx");
}

/** Lee el Excel → [{ fila, item, ean, descripcion }] */
export function leerPlantillaArticulos(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const hoja = wb.SheetNames.find(n => !/instruc/i.test(n)) || wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, defval: "", raw: true });
  const iEnc = aoa.slice(0, 10).findIndex(f => f.some(c => ENCABEZADOS.item.includes(norm(c))) && f.some(c => ENCABEZADOS.ean.includes(norm(c))));
  if (iEnc === -1) throw new Error("El archivo no tiene los encabezados de la plantilla (ITEM, EAN, DESCRIPCION). Descargue la plantilla y vuelva a intentarlo.");
  const enc = aoa[iEnc].map(norm);
  const col = Object.fromEntries(Object.entries(ENCABEZADOS).map(([k, alias]) => [k, enc.findIndex(h => alias.includes(h))]));
  const v = (f, k) => (col[k] === -1 ? "" : comoTexto(f[col[k]]));
  const filas = [];
  aoa.slice(iEnc + 1).forEach((f, k) => {
    if (!f.some(c => String(c ?? "").trim())) return;
    filas.push({ fila: iEnc + 2 + k, item: v(f, "item"), ean: v(f, "ean"), descripcion: v(f, "descripcion") });
  });
  if (!filas.length) throw new Error("La plantilla no tiene artículos diligenciados.");
  return filas;
}

/** Excel con el resultado de la carga (todas las filas o solo las no cargadas). */
export function descargarReporteArticulos(resultado, { soloNoCargados = false } = {}) {
  const filas = soloNoCargados ? resultado.filter(r => r.accion === "NO_CARGADO") : resultado;
  const ws = XLSX.utils.aoa_to_sheet([["FILA EXCEL", "ITEM", "EAN", "DESCRIPCION", "RESULTADO", "DETALLE"],
    ...filas.map(r => [r.fila, r.item, r.ean, r.descripcion, r.accion, r.detalle])]);
  ws["!cols"] = [{ wch: 10 }, { wch: 16 }, { wch: 18 }, { wch: 40 }, { wch: 14 }, { wch: 70 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, soloNoCargados ? "No cargados" : "Resultado");
  XLSX.writeFile(wb, soloNoCargados ? "articulos_no_cargados.xlsx" : "resultado_carga_articulos.xlsx");
}
