// ── parametrosService.js ─────────────────────────────────────────────────
// Parámetros por aplicación (core.parametros, SQL 024). Se editan en el menú
// Admon → Parámetros TomaPedido (solo administrador). Si la tabla aún no
// existe o falla la consulta, se usan los valores por defecto.
// ─────────────────────────────────────────────────────────────────────────
import { core } from "../lib/supabase";
import { mensajeError } from "./solicitudesService";

export const PARAMETROS_DEFECTO = {
  adjuntos_max_mb: 5,
  adjuntos_max_archivos: 5,
  adjuntos_tipos: ["zip", "jpg", "jpeg", "png", "webp"],
  adjuntos_retencion_meses: 1,
  solicitudes_rango_max_dias: 7,
  historico_rango_max_dias: 31,
};

let CACHE = null, cargadoEn = 0;

/** { clave: valor } de TOMAPEDIDO (con los valores por defecto para lo que falte). */
export async function cargarParametros({ forzar = false } = {}) {
  if (!forzar && CACHE && Date.now() - cargadoEn < 5 * 60000) return CACHE;
  try {
    const { data, error } = await core().from("parametros").select("clave,valor").eq("aplicacion", "TOMAPEDIDO");
    if (error) throw error;
    CACHE = { ...PARAMETROS_DEFECTO, ...Object.fromEntries(data.map(p => [p.clave, p.valor])) };
  } catch {
    CACHE = { ...PARAMETROS_DEFECTO };
  }
  cargadoEn = Date.now();
  return CACHE;
}

/** Filas completas para la pantalla de parámetros. */
export async function listarParametros(aplicacion = "TOMAPEDIDO") {
  const { data, error } = await core().from("parametros")
    .select("id,aplicacion,clave,valor,tipo,etiqueta,descripcion,unidad,minimo,maximo,orden,updated_at,version")
    .eq("aplicacion", aplicacion).order("orden");
  if (error) throw new Error(mensajeError(error));
  return data;
}

export async function guardarParametro(aplicacion, clave, valor) {
  const { error } = await core().rpc("fn_guardar_parametro", { p_aplicacion: aplicacion, p_clave: clave, p_valor: valor });
  if (error) throw new Error(mensajeError(error));
  CACHE = null;
}

/** Días entre dos fechas ISO (yyyy-mm-dd), contando ambos extremos. */
export const diasRango = (desde, hasta) =>
  Math.round((new Date(hasta + "T00:00:00") - new Date(desde + "T00:00:00")) / 86400000) + 1;
