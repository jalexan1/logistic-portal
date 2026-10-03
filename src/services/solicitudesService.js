// ── solicitudesService.js ────────────────────────────────────────────────
// Radicación transaccional de solicitudes de despacho.
// Toda la escritura pasa por despachos.fn_crear_solicitud (una transacción:
// encabezado + líneas + evento RADICADA, o nada). La llave de idempotencia
// garantiza que un doble clic o un reintento por red NO duplique el pedido.
// ─────────────────────────────────────────────────────────────────────────
import { despachos } from "../lib/supabase";

export const nuevaLlave = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

// "$ 1.234.567,89" → 1234567.89 · "12,50%" → 12.5 · vacío/ilegible → null
export function aNumero(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const esMoneda = String(v).includes("$");           // formato colombiano: punto = miles
  let s = String(v).replace(/[$%\s]/g, "");
  const neg = s.startsWith("-"); s = s.replace(/^-/, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (esMoneda || (s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const aLinea = (r) => ({
  entrega: r.entrega, destinatario: String(r.destinatario ?? ""), nombre: r.nombre, lugar: r.lugar,
  material: r.material, cantidad: aNumero(r.cantidad), um: r.um || "BUL",
  item: r.item === "" || r.item == null ? null : parseInt(r.item, 10) || null,
  bodega: r.bodega || null,
  producto: r.producto || null,
  precio: aNumero(r.precio), descuento_pct: aNumero(r.descuentoPct),
  subtotal: aNumero(r.subtotalLinea), total: aNumero(r.totalLinea),
});

/**
 * Radica la solicitud. Devuelve { id, numero, radicadaAt, totalLineas, totalUnidades, esReintento }.
 * Lanza Error con mensaje listo para mostrar al usuario.
 */
export async function radicarSolicitud({ llave, meta, filas, origen, pedidoHeader = null, archivo = null }) {
  const { data, error } = await despachos().rpc("fn_crear_solicitud", {
    p_idempotency_key: llave,
    p_area_solicitante: meta.area,
    p_solicitante_nombre: meta.solicitante,
    p_solicitante_correo: meta.correo,
    p_origen: origen,
    p_lineas: filas.map(aLinea),
    p_numero_pedido_origen: pedidoHeader?.numeroPedido || null,
    p_archivo_origen: archivo,
    p_datos_origen: pedidoHeader,
  });
  if (error) throw new Error(mensajeError(error));
  const r = Array.isArray(data) ? data[0] : data;
  if (!r?.numero) throw new Error("El servidor no confirmó la radicación. Reintente: no se duplicará.");
  return {
    id: r.solicitud_id, numero: r.numero, radicadaAt: r.radicada_at,
    totalLineas: r.total_lineas, totalUnidades: Number(r.total_unidades), esReintento: r.es_reintento,
  };
}

export async function listarSolicitudes({ desde, hasta, estado, texto, limite = 200 } = {}) {
  let q = despachos().from("vw_solicitudes")
    .select("id,numero,version,estado_codigo,estado_nombre,origen,area_solicitante,solicitante_nombre,solicitante_correo,numero_pedido_origen,total_lineas,total_unidades,radicada_at,fecha_radicacion,motivo_anulacion,lote_id,lote_numero,procesada_at")
    .order("radicada_at", { ascending: false }).limit(limite);
  if (desde)  q = q.gte("fecha_radicacion", desde);
  if (hasta)  q = q.lte("fecha_radicacion", hasta);
  if (estado) q = q.eq("estado_codigo", estado);
  if (texto) {
    const t = texto.replace(/[,()]/g, " ").trim();
    if (t) q = q.or(`numero.ilike.*${t}*,area_solicitante.ilike.*${t}*,numero_pedido_origen.ilike.*${t}*,solicitante_nombre.ilike.*${t}*`);
  }
  const { data, error } = await q;
  if (error) throw new Error(mensajeError(error));
  return data;
}

export async function obtenerLineas(solicitudId) {
  const { data, error } = await despachos().from("solicitud_lineas")
    .select("linea_nro,entrega,destinatario_nit,destinatario_nombre,destinatario_ciudad,material,producto_descripcion,cantidad,um,item,bodega")
    .eq("solicitud_id", solicitudId).order("linea_nro");
  if (error) throw new Error(mensajeError(error));
  return data;
}

export async function obtenerEventos(solicitudId) {
  const { data, error } = await despachos().from("solicitud_eventos")
    .select("estado_anterior,estado_nuevo,comentario,created_at")
    .eq("solicitud_id", solicitudId).order("created_at");
  if (error) throw new Error(mensajeError(error));
  return data;
}

// ── Procesamiento por bloque (lote) ──────────────────────────────────────
// Solo hay dos estados: RADICADA → PROCESADA. El paso se hace SIEMPRE por
// bloque (una o varias solicitudes) con despachos.fn_procesar_lote: una sola
// transacción (todas o ninguna) e idempotente por llave, igual que la radicación.

/** Devuelve { id, numero, totalSolicitudes, totalLineas, totalUnidades, procesadoAt, esReintento }. */
export async function procesarLote({ llave, solicitudIds, comentario }) {
  const { data, error } = await despachos().rpc("fn_procesar_lote", {
    p_solicitud_ids: solicitudIds, p_idempotency_key: llave, p_comentario: comentario || null,
  });
  if (error) throw new Error(mensajeError(error));
  const r = Array.isArray(data) ? data[0] : data;
  if (!r?.numero) throw new Error("El servidor no confirmó el procesamiento. Reintente: no se duplicará.");
  return {
    id: r.lote_id, numero: r.numero, totalSolicitudes: r.total_solicitudes, totalLineas: r.total_lineas,
    totalUnidades: Number(r.total_unidades), procesadoAt: r.procesado_at, esReintento: r.es_reintento,
  };
}

export async function listarLotes({ desde, hasta, limite = 100 } = {}) {
  let q = despachos().from("vw_lotes")
    .select("id,numero,total_solicitudes,total_lineas,total_unidades,comentario,procesado_at,fecha_proceso,procesado_por,revertido_at,motivo_reversion")
    .order("procesado_at", { ascending: false }).limit(limite);
  if (desde) q = q.gte("fecha_proceso", desde);
  if (hasta) q = q.lte("fecha_proceso", hasta);
  const { data, error } = await q;
  if (error) throw new Error(mensajeError(error));
  return data;
}

// Todas las líneas de un bloque, ordenadas por solicitud y línea.
// Se pagina de a 1000 (límite por consulta del API) para no truncar bloques grandes.
export async function obtenerLineasLote(loteId) {
  const PAGINA = 1000;
  const todas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await despachos().from("vw_lote_lineas")
      .select("solicitud_id,solicitud_numero,area_solicitante,solicitante_nombre,origen,numero_pedido_origen,radicada_at,linea_id,linea_nro,entrega,destinatario_nit,destinatario_nombre,destinatario_ciudad,material,producto_descripcion,cantidad,um,item,bodega")
      .eq("lote_id", loteId)
      .order("solicitud_numero").order("linea_nro").order("linea_id")
      .range(desde, desde + PAGINA - 1);
    if (error) throw new Error(mensajeError(error));
    todas.push(...data);
    if (data.length < PAGINA) break;
  }
  return todas;
}

/** Solo administrador: devuelve a RADICADA todas las solicitudes del bloque. */
export async function revertirLote({ loteId, motivo }) {
  const { data, error } = await despachos().rpc("fn_revertir_lote", { p_lote_id: loteId, p_motivo: motivo });
  if (error) throw new Error(mensajeError(error));
  return Array.isArray(data) ? data[0] : data;
}

// Convierte errores técnicos en mensajes para el usuario.
export function mensajeError(error) {
  const msg = error?.message || String(error || "");
  const m = msg.match(/^(DSP|CORE)\d{3}:\s*(.*)$/s);
  if (m) return m[2];
  if (/failed to fetch|networkerror|load failed/i.test(msg))
    return "Sin conexión con el servidor. La solicitud NO quedó confirmada: reintente (no se duplicará).";
  if (/JWT|expired|401/i.test(msg)) return "La sesión expiró. Vuelva a ingresar.";
  if (/permission denied|42501/i.test(msg)) return "No tiene permisos para esta operación.";
  return msg;
}
