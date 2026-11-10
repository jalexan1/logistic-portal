// ── tablaLineas.js ───────────────────────────────────────────────────────
// Columnas, valores y filtros de las tablas "una fila por línea" de Despachos:
//   · SolicitudesDelDia (pantalla Despachos)
//   · Solicitudes (bandeja "Solicitudes radicadas")
// Mismos campos que la plantilla de "Excel desde PDF". Un solo lugar para
// agregar o quitar una columna en ambas tablas.
// ─────────────────────────────────────────────────────────────────────────
import { fechaHoraBogota } from "./fechas";

export const ESTADO_UI = {
  RADICADA:  { label: "Radicada",  color: "#2563EB", bg: "#EFF6FF" },
  PROCESADA: { label: "Procesada", color: "#0F6E56", bg: "#E1F5EE" },
  ANULADA:   { label: "Anulada",   color: "#C0392B", bg: "#FFF0EE" },   // 10-nov: se anula con motivo (SQL 035)
};
export const uiEstado = (codigo, nombre) =>
  ESTADO_UI[codigo] || { label: nombre || codigo, color: "#6B8F80", bg: "#F2F8F5" };

// key = campo de despachos.vw_solicitud_lineas (o calculado en valorCelda)
export const COLUMNAS_LINEAS = [
  { key: "fecha",                     titulo: "Fecha y hora",        w: 128 },
  { key: "proceso",                   titulo: "Motivo",              w: 100 },   // 28-oct
  // 10-nov: observaciones junto al motivo; se muestra la primera palabra y «ver más» (texto completo al pasar el mouse)
  { key: "observacion_general",       titulo: "Obs. pedido",         w: 122, obs: true },
  { key: "observaciones",             titulo: "Obs. línea",          w: 122, obs: true },
  { key: "adjuntos",                  titulo: "Adjunto",             w: 84, centro: true },  // 28-oct: 📎 n
  { key: "numero",                    titulo: "N° solicitud",        w: 132, fuerte: true },
  { key: "estado",                    titulo: "Estado",              w: 104 },
  { key: "area_solicitante",          titulo: "Área",                w: 110 },
  { key: "solicitante_nombre",        titulo: "Solicitante",         w: 160 },
  { key: "solicitante_correo",        titulo: "Correo electrónico",  w: 190 },
  { key: "entrega",                   titulo: "Entrega",             w: 120 },
  { key: "destinatario_nit",          titulo: "Destinatario (NIT)",  w: 118 },
  { key: "destinatario_nombre",       titulo: "Nombre destinatario", w: 210 },
  { key: "destinatario_direccion",    titulo: "Dirección",           w: 180 },
  { key: "destinatario_ciudad",       titulo: "Ciudad",              w: 110 },
  { key: "destinatario_departamento", titulo: "Departamento",        w: 120 },
  { key: "destinatario_telefono",     titulo: "Teléfono",            w: 112 },
  { key: "material",                  titulo: "SKU",                 w: 120 },
  { key: "ean",                       titulo: "EAN",                 w: 130 },
  { key: "cantidad",                  titulo: "Cantidad",            w: 80, num: true },
  { key: "um",                        titulo: "UM",                  w: 56 },
  { key: "item",                      titulo: "Ítem",                w: 60 },
  { key: "bodega",                    titulo: "Bodega",              w: 64 },
  { key: "origen",                    titulo: "Origen",              w: 70 },
  { key: "lote_numero",               titulo: "Bloque",              w: 140 },
  { key: "consentimiento",            titulo: "Consentimiento",      w: 150 },   // 29-oct: alerta de inventario aceptada
];

export const valorCelda = (f, key) =>
  key === "fecha" ? fechaHoraBogota(f.radicada_at)
  : key === "proceso" ? etiquetaMotivo(f.proceso)
  : key === "adjuntos" ? (f.adjuntos?.length ? String(f.adjuntos.length) : "")
  : key === "consentimiento" ? textoConsentimiento(f.consentimiento_at)
  : key === "estado" ? uiEstado(f.estado_codigo, f.estado_nombre).label
  : key === "origen" ? ({ PDF: "PDF", EXCEL: "Excel" }[f.origen] || "Manual")
  : f[key] ?? "";

// Constancia de la alerta de inventario (SQL 032): "✓ 29/10/2026 14:05" o vacío
export const textoConsentimiento = (at) => (at ? "✓ " + fechaHoraBogota(at) : "");

// Filtro de columna: "texto" = contiene · * = cualquier texto en medio ("bell*group", "PTC*2025")
export const coincide = (valor, filtro) => {
  const f = String(filtro || "").trim().toLowerCase();
  if (!f) return true;
  const v = String(valor ?? "").toLowerCase();
  if (!f.includes("*")) return v.includes(f);
  const re = new RegExp(f.split("*").map(p => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
  return re.test(v);
};

export const filtrarLineas = (lineas, filtros, columnas = COLUMNAS_LINEAS) =>
  lineas.filter(f => columnas.every(c => coincide(valorCelda(f, c.key), filtros[c.key])));

// ── Listas del encabezado de la solicitud (pantalla Despachos) ──────────
// valor = lo que se guarda en la base · etiqueta = lo que ve el usuario
export const AREAS = [
  { valor: "LOGISTICA",  etiqueta: "Logística" },
  { valor: "COMPRAS",    etiqueta: "Compras" },
  { valor: "CALIDAD",    etiqueta: "Calidad" },
  { valor: "PLANEACION", etiqueta: "Planeación" },
  { valor: "JEFATURA",   etiqueta: "Jefatura" },
  { valor: "GERENCIA",   etiqueta: "Gerencia" },
];
// Motivo (antes "Proceso"; se guarda en la columna proceso)
export const MOTIVOS = [
  { valor: "VARIOS",     etiqueta: "Varios" },
  { valor: "RAPPI",      etiqueta: "Rappi" },
  { valor: "LUEGO PAGO", etiqueta: "Luego Pago" },
  { valor: "FARMATODO",  etiqueta: "Farmatodo" },
  { valor: "MP",         etiqueta: "MP" },
];
// Motivos SIN datos de cliente: NIT, nombre, dirección, teléfono, ciudad y
// departamento no se exigen y se llenan con la palabra del motivo.
export const MOTIVOS_SIN_CLIENTE = ["LUEGO PAGO", "FARMATODO"];
export const etiquetaMotivo = (v) => MOTIVOS.find(m => m.valor === v)?.etiqueta || v || "";
export const etiquetaArea = (v) => AREAS.find(a => a.valor === v)?.etiqueta || v || "";

// ── Revisión de clientes (SQL 034): campo de pantalla → código de core.destinatarios.campos_corregir
export const CAMPOS_CLIENTE_REVISION = [
  { k: "nombre",       codigo: "NOMBRE",       titulo: "Nombre" },
  { k: "direccion",    codigo: "DIRECCION",    titulo: "Dirección" },
  { k: "telefono",     codigo: "TELEFONO",     titulo: "Teléfono" },
  { k: "ciudad",       codigo: "CIUDAD",       titulo: "Ciudad" },
  { k: "departamento", codigo: "DEPARTAMENTO", titulo: "Departamento" },
];
export const nombreCampos = (codigos = []) =>
  CAMPOS_CLIENTE_REVISION.filter(c => codigos.includes(c.codigo)).map(c => c.titulo).join(", ");
