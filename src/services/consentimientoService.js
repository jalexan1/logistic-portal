// ── consentimientoService.js ─────────────────────────────────────────────
// Alerta de inventario que el solicitante acepta ANTES de cargar un pedido
// (Carga de pedidos: plantilla Excel o PDF). SQL 032.
//  · El texto viene de la base (despachos.consentimiento_textos, versión vigente).
//  · La aceptación se guarda en despachos.consentimientos con el texto exacto.
//  · Al radicar, se enlaza con la solicitud DSE-… (fn_vincular_consentimiento).
// ─────────────────────────────────────────────────────────────────────────
import { despachos } from "../lib/supabase";
import { mensajeError } from "./solicitudesService";

// Respaldo si la consulta del texto falla (mismo texto de la versión 1 del SQL 032)
export const TEXTO_RESPALDO = {
  version: 1,
  titulo: "Valide el inventario antes de radicar.",
  texto: "Si radica sin validar el inventario disponible, el pedido queda autorizado para prepararse y despacharse con las cantidades existentes con las que cuenta el OPL. "
    + "Recuerde que hay solicitudes pendientes por delante que pueden comprometer las cantidades que usted está solicitando. "
    + "Si el pedido no está autorizado para ejecutarse de forma parcial, por favor no lo radique y consulte la disponibilidad con el OPL.",
};

let CACHE = null;
/** Texto vigente { version, titulo, texto } (se consulta una vez por sesión). */
export async function textoVigente() {
  if (CACHE) return CACHE;
  const { data, error } = await despachos().from("consentimiento_textos")
    .select("version,titulo,texto").eq("vigente", true).limit(1);
  if (error) throw new Error(mensajeError(error));
  CACHE = (data && data[0]) || TEXTO_RESPALDO;
  return CACHE;
}

/** Registra la aceptación (texto de la base) → { id, version, aceptado_at } */
export async function registrarConsentimiento({ version, origen, archivo }) {
  const { data, error } = await despachos().rpc("fn_registrar_consentimiento", {
    p_version: version ?? null, p_origen: origen, p_archivo: archivo || null,
  });
  if (error) throw new Error(mensajeError(error));
  return Array.isArray(data) ? data[0] : data;
}

/** Enlaza la aceptación con la solicitud radicada (idempotente). */
export async function vincularConsentimiento(consentimientoId, solicitudId) {
  const { error } = await despachos().rpc("fn_vincular_consentimiento", { p_consentimiento_id: consentimientoId, p_solicitud_id: solicitudId });
  if (error) throw new Error(mensajeError(error));
}
