// ── maestrosService.js ───────────────────────────────────────────────────
// Consultas a los maestros para las lupas (popups de búsqueda) y el EAN.
//  · core.destinatarios → NIT, nombre, dirección, ciudad, departamento, teléfono
//  · core.item_ean      → Item (SKU base), EAN, descripción
// Búsqueda con comodines: "*" o "%" = cualquier texto en medio
// ("bell*group" encuentra "BELLPROF GROUP S.A.S"). Siempre busca en cualquier
// parte del campo y no distingue mayúsculas.
// ─────────────────────────────────────────────────────────────────────────
import { core } from "../lib/supabase";

// "bell*group" → "%bell%group%" · "bell" → "%bell%"
export const patronComodin = (v) => {
  const t = String(v || "").trim().replace(/[,()]/g, " ");
  if (!t) return null;
  return `%${t.replace(/\*/g, "%")}%`.replace(/%{2,}/g, "%");
};

// SKU del PDF → SKU base del maestro: "PTC7300-2025" → "PTC7300", "PTC8200 - 2026" → "PTC8200"
// (misma regla que core.fn_sku_base en la base de datos)
export const skuBase = (sku) =>
  String(sku || "").toUpperCase().replace(/\s+/g, "").replace(/-(19|20)\d{2}$/, "");

// ── Item / EAN (se carga completo: son pocos cientos de registros) ──────
let ITEMS = null;          // item → { ean, descripcion }
let cargadoEn = 0;

export async function cargarItemsEan({ forzar = false } = {}) {
  if (!forzar && ITEMS && Date.now() - cargadoEn < 10 * 60000) return ITEMS;
  const nuevos = new Map();
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await core().from("item_ean")
      .select("item,ean,descripcion").eq("activo", true).order("item").range(desde, desde + 999);
    if (error) throw new Error("No se pudo cargar el maestro Item/EAN: " + error.message);
    data.forEach(r => { if (!nuevos.has(r.item)) nuevos.set(r.item, { ean: r.ean, descripcion: r.descripcion || "" }); });
    if (data.length < 1000) break;
  }
  ITEMS = nuevos; cargadoEn = Date.now();
  return ITEMS;
}

/** EAN de un SKU: primero exacto, luego por SKU base. null si no está en el maestro. */
export function eanDeSku(sku) {
  if (!ITEMS || !sku) return null;
  const exacto = String(sku).toUpperCase().trim();
  return ITEMS.get(exacto) || ITEMS.get(skuBase(sku)) || null;
}

export async function buscarItems({ item, ean, descripcion } = {}, limite = 100) {
  let q = core().from("item_ean").select("item,ean,descripcion").eq("activo", true).order("item").limit(limite);
  const pi = patronComodin(item), pe = patronComodin(ean), pd = patronComodin(descripcion);
  if (pi) q = q.ilike("item", pi);
  if (pe) q = q.ilike("ean", pe);
  if (pd) q = q.ilike("descripcion", pd);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

export async function buscarDestinatarios({ nit, nombre, ciudad } = {}, limite = 100) {
  let q = core().from("destinatarios")
    .select("nit,nombre,direccion,ciudad,departamento,telefono").eq("activo", true).order("nombre").limit(limite);
  const pn = patronComodin(nit), pm = patronComodin(nombre), pc = patronComodin(ciudad);
  if (pn) q = q.ilike("nit", pn);
  if (pm) q = q.ilike("nombre", pm);
  if (pc) q = q.ilike("ciudad", pc);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}
