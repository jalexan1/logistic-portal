// ── plantillaClientesExcel.js ────────────────────────────────────────────
// Plantilla de carga masiva de clientes (Maestros → Clientes).
// Columnas: NIT | NOMBRE | DIRECCION | TELEFONO | CIUDAD | DEPARTAMENTO | TELEFONO 2
// (TELEFONO 2 es opcional y va al final). También acepta el formato del
// archivo de clientes actual (nit, nombrecliente, ciudaddestino, dptodestino).
// Limpieza: quita * y comillas del nombre, el indicativo 57 del teléfono, espacios
// invisibles; si el teléfono trae dos números, el segundo pasa a TELEFONO 2.
// ─────────────────────────────────────────────────────────────────────────
import * as XLSX from "xlsx";

export const COLUMNAS_PLANTILLA_CLIENTES = ["NIT", "NOMBRE", "DIRECCION", "TELEFONO", "CIUDAD", "DEPARTAMENTO", "TELEFONO 2"];

const norm = (v) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const ENCABEZADOS = {
  nit:          ["nit", "nit cliente", "documento", "nit destinatario"],
  nombre:       ["nombre", "nombrecliente", "nombre cliente", "razon social", "nombre destinatario"],
  direccion:    ["direccion", "direccion destino"],
  telefono:     ["telefono", "telefono 1", "celular"],
  ciudad:       ["ciudad", "ciudaddestino", "ciudad destino"],
  departamento: ["departamento", "dptodestino", "dpto destino", "dpto"],
  telefono_2:   ["telefono 2", "telefono2", "celular 2", "telefono adicional"],
};

/** Descarga la plantilla vacía con una fila de ejemplo y una hoja de instrucciones. */
export function descargarPlantillaClientes() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([COLUMNAS_PLANTILLA_CLIENTES,
    ["900238615-7", "EMPRESA EJEMPLO SAS", "CL 10 # 20-30", "3001234567", "MEDELLÍN", "Antioquia", ""]]);
  ws["!cols"] = [{ wch: 16 }, { wch: 36 }, { wch: 36 }, { wch: 15 }, { wch: 16 }, { wch: 16 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, "Clientes");
  const ins = XLSX.utils.aoa_to_sheet([
    ["Instrucciones para la carga masiva de clientes"], [],
    ["Columna", "Obligatoria", "Notas"],
    ["NIT", "Sí", "NIT, cédula o código de tienda, desde 1 dígito (8, 70, 105). El NIT puede ir con o sin dígito de verificación (900238615-7); se guarda sin dígito: 900238615."],
    ["NOMBRE", "Sí", "Si el NIT ya existe con OTRO nombre, la fila no se carga y sale en el reporte."],
    ["DIRECCION", "No", ""],
    ["TELEFONO", "Sí", "Solo números. Se quita el +57 si viene."],
    ["CIUDAD", "No", ""],
    ["DEPARTAMENTO", "No", "Si viene vacío se deduce de la ciudad."],
    ["TELEFONO 2", "No", "Segundo teléfono o celular (opcional)."],
    [], ["Borre la fila de ejemplo antes de cargar. La carga se puede repetir: no duplica clientes."],
  ]);
  ins["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, ins, "Instrucciones");
  XLSX.writeFile(wb, "Plantilla_Clientes.xlsx");
}

// Teléfono(s): quita '+57, separa dos números ("3105576112 - 3238122920")
export function separarTelefonos(valor) {
  const t = String(valor ?? "").replace(/\.0+$/, "").trim();
  if (!t) return ["", ""];
  const partes = t.split(/\s*[-/;,|]\s*|\s+y\s+/i).filter(p => p.replace(/\D/g, "").length >= 7);
  // Sin indicativo de Colombia: '+57, +57 o 57 delante de celular (3…) o fijo (60…)
  const limpio = (p) => String(p).replace(/^\s*'?\s*\+\s*57/, "").replace(/\D/g, "").replace(/^57(3\d{9}|60\d{8})$/, "$1");
  if (partes.length > 1) return [limpio(partes[0]), limpio(partes[1])];
  return [limpio(t), ""];
}
export const limpiarNombre = (v) => String(v ?? "").replace(/[*"\u201c\u201d]/g, "").replace(/[\s\u00a0]+/g, " ").trim();
const limpiarTexto = (v) => String(v ?? "").replace(/[\s\u00a0]+/g, " ").trim();

/** Lee el Excel → [{ fila, nit, nombre, direccion, telefono, ciudad, departamento, telefono_2 }] */
export function leerPlantillaClientes(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const hoja = wb.SheetNames.find(n => !/instruc/i.test(n)) || wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, defval: "", raw: false });
  const iEnc = aoa.slice(0, 10).findIndex(f => f.some(c => ENCABEZADOS.nit.includes(norm(c))) && f.some(c => ENCABEZADOS.nombre.includes(norm(c))));
  if (iEnc === -1) throw new Error("El archivo no tiene los encabezados de la plantilla (NIT, NOMBRE…). Descargue la plantilla y vuelva a intentarlo.");
  const enc = aoa[iEnc].map(norm);
  const col = Object.fromEntries(Object.entries(ENCABEZADOS).map(([k, alias]) => [k, enc.findIndex(h => alias.includes(h))]));
  const faltan = ["nit", "nombre", "telefono"].filter(k => col[k] === -1);
  if (faltan.length) throw new Error(`Faltan las columnas: ${faltan.map(k => k.toUpperCase()).join(", ")}.`);
  const v = (f, k) => (col[k] === -1 ? "" : f[col[k]]);
  const filas = [];
  aoa.slice(iEnc + 1).forEach((f, k) => {
    if (!f.some(c => String(c ?? "").trim())) return;
    const [t1, t2Sep] = separarTelefonos(v(f, "telefono"));
    const [t2] = separarTelefonos(v(f, "telefono_2"));
    filas.push({
      fila: iEnc + 2 + k,
      nit: String(v(f, "nit")).trim(),
      nombre: limpiarNombre(v(f, "nombre")),
      direccion: limpiarTexto(v(f, "direccion")),
      telefono: t1,
      telefono_2: t2 || t2Sep,
      ciudad: limpiarTexto(v(f, "ciudad")),
      departamento: limpiarTexto(v(f, "departamento")),
    });
  });
  if (!filas.length) throw new Error("La plantilla no tiene clientes diligenciados.");
  return filas;
}

/** Excel con el resultado de la carga (todas las filas o solo las no cargadas). */
export function descargarReporteCarga(resultado, { soloNoCargados = false } = {}) {
  const filas = soloNoCargados ? resultado.filter(r => r.accion === "NO_CARGADO") : resultado;
  const ws = XLSX.utils.aoa_to_sheet([["FILA EXCEL", "NIT", "NOMBRE", "RESULTADO", "DETALLE"],
    ...filas.map(r => [r.fila, r.nit, r.nombre, r.accion, r.detalle])]);
  ws["!cols"] = [{ wch: 10 }, { wch: 16 }, { wch: 36 }, { wch: 14 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, soloNoCargados ? "No cargados" : "Resultado");
  XLSX.writeFile(wb, soloNoCargados ? "clientes_no_cargados.xlsx" : "resultado_carga_clientes.xlsx");
}
