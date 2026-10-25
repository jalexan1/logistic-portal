// ── adjuntosService.js ───────────────────────────────────────────────────
// Adjuntos de la solicitud (.zip, imágenes, QR) — SQL 024.
//  · Archivo: Storage, bucket privado "despachos-adjuntos", ruta <id>/<archivo>
//  · Registro: despachos.solicitud_adjuntos (valida tamaño, cantidad y tipo
//    con los parámetros de Admon → Parámetros TomaPedido)
// Política de documentos: 1 mes en la aplicación; luego el administrador los
// pasa al disco duro (Admon → Administración BD y adjuntos).
// ─────────────────────────────────────────────────────────────────────────
import { supabase, despachos } from "../lib/supabase";
import { mensajeError } from "./solicitudesService";

const BUCKET = "despachos-adjuntos";
const ext = (n) => (String(n || "").match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() || "";
const nombreSeguro = (n) => String(n || "archivo").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
export const tamanoLegible = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Valida archivos contra los parámetros. Devuelve { validos, errores[] }. */
export function validarAdjuntos(archivos, yaAgregados, p) {
  const errores = [], validos = [];
  const tipos = (p.adjuntos_tipos || []).map(t => String(t).toLowerCase());
  let total = yaAgregados.length;
  for (const f of archivos) {
    if (!tipos.includes(ext(f.name))) { errores.push(`«${f.name}»: tipo no permitido (permitidos: ${tipos.join(", ")})`); continue; }
    if (f.size > p.adjuntos_max_mb * 1048576) { errores.push(`«${f.name}»: supera ${p.adjuntos_max_mb} MB`); continue; }
    if (yaAgregados.some(a => a.name === f.name && a.size === f.size)) continue;
    if (total >= p.adjuntos_max_archivos) { errores.push(`Máximo ${p.adjuntos_max_archivos} adjuntos por solicitud`); break; }
    validos.push(f); total++;
  }
  return { validos, errores };
}

/** Sube y registra los adjuntos de una solicitud ya radicada. Devuelve { subidos, errores[] }. */
export async function subirAdjuntos(solicitudId, archivos) {
  let subidos = 0; const errores = [];
  for (const f of archivos) {
    const ruta = `${solicitudId}/${Date.now()}_${nombreSeguro(f.name)}`;
    const { error: eUp } = await supabase.storage.from(BUCKET).upload(ruta, f, { contentType: f.type || undefined, upsert: false });
    if (eUp) { errores.push(`«${f.name}»: ${eUp.message}`); continue; }
    const { error } = await despachos().rpc("fn_registrar_adjunto", {
      p_solicitud_id: solicitudId, p_ruta: ruta, p_nombre: f.name, p_tipo_mime: f.type || null, p_tamano_bytes: f.size,
    });
    if (error) { errores.push(`«${f.name}»: ${mensajeError(error)}`); await supabase.storage.from(BUCKET).remove([ruta]); continue; }
    subidos++;
  }
  return { subidos, errores };
}

/** Adjuntos vigentes de varias solicitudes → { solicitud_id: [adjuntos] } */
export async function listarAdjuntos(solicitudIds) {
  const ids = [...new Set(solicitudIds)].filter(Boolean);
  const mapa = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await despachos().from("solicitud_adjuntos")
      .select("id,solicitud_id,ruta,nombre,tipo_mime,tamano_bytes,created_at")
      .in("solicitud_id", ids.slice(i, i + 200)).is("eliminado_at", null).order("id");
    if (error) throw new Error(mensajeError(error));
    data.forEach(a => { (mapa[a.solicitud_id] = mapa[a.solicitud_id] || []).push(a); });
  }
  return mapa;
}

/** Descarga un adjunto con un enlace temporal (60 s). `prefijo` va antes del nombre. */
export async function descargarAdjunto(adj, prefijo = "") {
  const nombre = `${prefijo ? prefijo + "_" : ""}${adj.nombre}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(adj.ruta, 60, { download: nombre });
  if (error) throw new Error(error.message);
  const a = document.createElement("a");
  a.href = data.signedUrl; a.download = nombre; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}

// ── Administración (solo admin) ──────────────────────────────────────────
export async function resumenAdjuntos() {
  const { data, error } = await despachos().rpc("fn_resumen_adjuntos");
  if (error) throw new Error(mensajeError(error));
  return Array.isArray(data) ? data[0] : data;
}
export async function adjuntosVencidos() {
  const { data, error } = await despachos().rpc("fn_adjuntos_vencidos");
  if (error) throw new Error(mensajeError(error));
  return data || [];
}
export async function marcarAdjuntos(ids, accion) {
  const { data, error } = await despachos().rpc("fn_marcar_adjuntos", { p_ids: ids, p_accion: accion });
  if (error) throw new Error(mensajeError(error));
  return data;
}
/** Borra del Storage los adjuntos YA respaldados y los marca como eliminados. */
export async function eliminarAdjuntosRespaldados(adjuntos) {
  const listos = adjuntos.filter(a => a.respaldado_at);
  if (!listos.length) return 0;
  const { error } = await supabase.storage.from(BUCKET).remove(listos.map(a => a.ruta));
  if (error) throw new Error(error.message);
  return marcarAdjuntos(listos.map(a => a.id), "ELIMINADO");
}
