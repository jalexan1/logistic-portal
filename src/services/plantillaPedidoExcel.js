// ── plantillaPedidoExcel.js ──────────────────────────────────────────────
// Lectura del pedido cargado con la plantilla "Plantilla_Pedido.xlsx" y
// comparación de los datos del cliente contra el maestro.
//
// Columnas de la plantilla (en cualquier orden; no importan mayúsculas,
// tildes ni espacios de más en el encabezado):
//   Entrega | Nit | Nombre destinatario | Direccion | Telefono | Ciudad |
//   Departamento | Material | Cantidad | Observaciones
// ─────────────────────────────────────────────────────────────────────────
import * as XLSX from "xlsx";

export const URL_PLANTILLA = `${import.meta.env.BASE_URL || "/"}Plantilla_Pedido.xlsx`;

const norm = (v) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim();

// campo interno → nombres aceptados en el encabezado
const ENCABEZADOS = {
  entrega:       ["entrega"],
  destinatario:  ["nit", "destinatario nit", "nit destinatario", "destinatario"],
  nombre:        ["nombre destinatario", "nombre", "destinatario nombre", "cliente"],
  direccion:     ["direccion"],
  telefono:      ["telefono", "celular"],
  lugar:         ["ciudad", "lugar"],
  departamento:  ["departamento", "dpto"],
  material:      ["material", "sku", "item sku"],
  cantidad:      ["cantidad", "cantidad entrega"],
  observaciones: ["observaciones", "observacion", "notas"],
};
const OBLIGATORIAS = ["entrega", "destinatario", "material", "cantidad"];
const NOMBRE_COLUMNA = { entrega: "Entrega", destinatario: "Nit", material: "Material", cantidad: "Cantidad" };

// 900313153 (número) → "900313153" · "900.313.153-1" → "9003131531"
const limpiarNit = (v) => String(v ?? "").replace(/\.0+$/, "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
const texto = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const aCantidad = (v) => {
  if (typeof v === "number") return v;
  const t = String(v ?? "").trim();
  if (!t) return "";
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : "";
};

/**
 * Lee el Excel de la plantilla. Devuelve { filas, hoja } o lanza Error con un
 * mensaje claro (columnas faltantes, archivo vacío…).
 * filas: [{ entrega, destinatario, nombre, direccion, telefono, lugar, departamento,
 *           material, cantidad, observaciones, filaExcel }]
 */
export function leerPlantillaPedido(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const nombreHoja = wb.SheetNames.find(n => norm(n) === "plantilla") || wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja], { header: 1, defval: "", raw: true });

  // Fila de encabezados: la primera (de las 10 primeras) que tenga Entrega y Material
  const iEnc = aoa.slice(0, 10).findIndex(f => f.some(c => norm(c) === "entrega") && f.some(c => ENCABEZADOS.material.includes(norm(c))));
  if (iEnc === -1) throw new Error("El archivo no tiene el formato de la plantilla: no se encontraron los encabezados «Entrega» y «Material». Descargue la plantilla y vuelva a intentarlo.");
  const enc = aoa[iEnc].map(norm);
  const col = Object.fromEntries(Object.entries(ENCABEZADOS).map(([k, alias]) => [k, enc.findIndex(h => alias.includes(h))]));
  const faltan = OBLIGATORIAS.filter(k => col[k] === -1).map(k => NOMBRE_COLUMNA[k]);
  if (faltan.length) throw new Error(`A la plantilla le faltan las columnas: ${faltan.join(", ")}.`);

  const valor = (fila, k) => (col[k] === -1 ? "" : fila[col[k]]);
  const filas = [];
  aoa.slice(iEnc + 1).forEach((f, k) => {
    if (!f.some(c => String(c ?? "").trim())) return;      // fila vacía
    filas.push({
      entrega:       texto(valor(f, "entrega")).toUpperCase(),
      destinatario:  limpiarNit(valor(f, "destinatario")),
      nombre:        texto(valor(f, "nombre")).toUpperCase(),
      direccion:     texto(valor(f, "direccion")).toUpperCase(),
      telefono:      texto(valor(f, "telefono")).replace(/\.0+$/, ""),
      lugar:         texto(valor(f, "lugar")).toUpperCase(),
      departamento:  texto(valor(f, "departamento")),
      material:      texto(valor(f, "material")).toUpperCase().replace(/\s*-\s*/g, "-"),
      cantidad:      aCantidad(valor(f, "cantidad")),
      observaciones: texto(valor(f, "observaciones")),
      filaExcel:     iEnc + 2 + k,
    });
  });
  if (!filas.length) throw new Error("La plantilla no tiene líneas diligenciadas.");
  return { filas, hoja: nombreHoja };
}

// ── Comparación contra el maestro de clientes ───────────────────────────
/**
 * NIT tal como está en el maestro. Algunos NIT se guardaron con el dígito de
 * verificación pegado (901443866 → 9014438660): si el exacto no existe, se
 * acepta el que solo agrega un dígito al final. "" si no existe.
 */
export function resolverNit(maestro, nit) {
  const n = String(nit || "").trim();
  if (!n) return "";
  if (maestro[n]) return n;
  const conDv = Object.keys(maestro).filter(k => k.length === n.length + 1 && k.startsWith(n));
  return conDv.length === 1 ? conDv[0] : "";
}

const CAMPOS_CLIENTE = [
  ["nombre", "nombre", "Nombre"],
  ["direccion", "direccion", "Dirección"],
  ["telefono", "telefono", "Teléfono"],
  ["lugar", "ciudad", "Ciudad"],
  ["departamento", "departamento", "Departamento"],
];
const igual = (a, b) => norm(a).replace(/\s+/g, "") === norm(b).replace(/\s+/g, "");
// Teléfonos: solo dígitos y sin el indicativo de Colombia (57 3102229020 = 3102229020)
const tel = (v) => String(v ?? "").replace(/\D/g, "").replace(/^57(?=\d{10}$)/, "");
const mismoDato = (campo, a, b) => (campo === "telefono" ? tel(a) === tel(b) : igual(a, b));

/**
 * Agrupa por Entrega + NIT y compara con el maestro (BD_CLIENTES: nit → datos).
 * Solo cuenta como diferencia cuando la plantilla Y el maestro traen el dato y
 * son distintos (sin tildes, mayúsculas ni espacios). Si uno viene vacío, no.
 * Devuelve { noEncontrados: [{ idx, entrega, nit, nombre, datos }],
 *            inconsistentes: [{ idx, entrega, nit, diferencias: [{ campo, excel, base }] }] }
 */
export function compararConMaestro(filas, maestro) {
  const noEncontrados = [], inconsistentes = [], vistos = new Set();
  filas.forEach((r, idx) => {
    const clave = `${r.entrega}¦${r.destinatario}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    const m = r.destinatario ? maestro[r.destinatario] : null;
    if (!m) {
      noEncontrados.push({ idx, entrega: r.entrega, nit: r.destinatario, nombre: r.nombre,
        datos: { nit: r.destinatario, nombre: r.nombre, direccion: r.direccion, ciudad: r.lugar, departamento: r.departamento, telefono: r.telefono } });
      return;
    }
    const diferencias = CAMPOS_CLIENTE
      .filter(([kf, km]) => String(r[kf] || "").trim() && String(m[km] || "").trim() && !mismoDato(kf, r[kf], m[km]))
      .map(([kf, km, campo]) => ({ campo, excel: r[kf], base: m[km] }));
    if (diferencias.length) inconsistentes.push({ idx, entrega: r.entrega, nit: r.destinatario, diferencias });
  });
  return { noEncontrados, inconsistentes };
}
