// ── articulosService.js ──────────────────────────────────────────────────
// Maestro de artículos (core.item_ean: Item/SKU, EAN, descripción).
// Maestros → Artículos (supervisor = operador, y admin). SQL 026.
// ─────────────────────────────────────────────────────────────────────────
import { core, despachos } from "../lib/supabase";
import { mensajeError } from "./solicitudesService";
import { cargarItemsEan } from "./maestrosService";

export async function listarArticulos() {
  const todos = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await core().from("item_ean")
      .select("id,item,ean,descripcion,activo,created_at,updated_at,version").order("item").range(desde, desde + 999);
    if (error) throw new Error(mensajeError(error));
    todos.push(...data);
    if (data.length < 1000) break;
  }
  return todos;
}

// Después de cada cambio se recarga el maestro que usa Despachos para el EAN
const refrescar = () => cargarItemsEan({ forzar: true }).catch(() => {});

export async function guardarArticulo({ id = null, item, ean, descripcion, version = null }) {
  const { data, error } = await despachos().rpc("fn_guardar_articulo", { p_id: id, p_item: item, p_ean: ean, p_descripcion: descripcion || null, p_version: version });
  if (error) throw new Error(mensajeError(error));
  refrescar();
  return data;
}
export async function cambiarActivoArticulo({ id, activo }) {
  const { error } = await despachos().rpc("fn_activo_articulo", { p_id: id, p_activo: activo });
  if (error) throw new Error(mensajeError(error));
  refrescar();
}
export async function borrarArticulo(id) {
  const { error } = await despachos().rpc("fn_borrar_articulo", { p_id: id });
  if (error) throw new Error(mensajeError(error));
  refrescar();
}
