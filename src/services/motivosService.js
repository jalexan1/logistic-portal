// ── motivosService.js ───────────────────────────────────────────────────
// 12-nov (SQL 036): catálogo de motivos en la base (despachos.motivos).
// Se carga una vez al iniciar sesión (AuthGate). Un motivo nuevo se agrega
// con un INSERT en la base, sin publicar de nuevo el portal.
// Si la tabla aún no existe o falla la red, el portal sigue con la lista de
// respaldo de utils/tablaLineas.js (mismo contenido del 036).
// ─────────────────────────────────────────────────────────────────────────
import { despachos } from "../lib/supabase";
import { aplicarMotivos } from "../utils/tablaLineas";

export async function cargarMotivos() {
  try {
    const { data, error } = await despachos().from("motivos")
      .select("codigo,nombre,orden,sin_cliente,activo")
      .order("orden");
    if (error) throw error;
    aplicarMotivos(data || []);
  } catch (e) {
    console.warn("Motivos: se usa la lista de respaldo del portal.", e?.message || e);
  }
}
