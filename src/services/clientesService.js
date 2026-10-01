// ── clientesService.js ───────────────────────────────────────────────────
// Maestro de destinatarios. ANTES: ~1.100 NIT/cédulas con nombre quemados en
// este archivo y publicados en el JS (sin login). AHORA: se leen de
// core.destinatarios, protegido por login y RLS, al iniciar sesión.
//
// Se conserva la misma interfaz (BD_CLIENTES como objeto nit → {nombre, ciudad},
// buscarPorNit, buscarPorNombre) para no reescribir PortalDespachos.jsx.
// ─────────────────────────────────────────────────────────────────────────
import { core } from "../lib/supabase";

const BD_CLIENTES = {};
let cargadoEn = 0;
const PAGINA = 1000; // límite por consulta del API de Supabase

export async function cargarDestinatarios({ forzar = false } = {}) {
  if (!forzar && cargadoEn && Date.now() - cargadoEn < 10 * 60000) return Object.keys(BD_CLIENTES).length;
  const nuevos = {};
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await core().from("destinatarios")
      .select("nit,nombre,ciudad").eq("activo", true)
      .order("nit").range(desde, desde + PAGINA - 1);
    if (error) throw new Error("No se pudo cargar el maestro de destinatarios: " + error.message);
    data.forEach(d => { nuevos[String(d.nit).trim()] = { nombre: d.nombre, ciudad: d.ciudad || "" }; });
    if (data.length < PAGINA) break;
  }
  Object.keys(BD_CLIENTES).forEach(k => delete BD_CLIENTES[k]);
  Object.assign(BD_CLIENTES, nuevos);
  cargadoEn = Date.now();
  return Object.keys(BD_CLIENTES).length;
}

export const buscarPorNit = (nit) => BD_CLIENTES[String(nit).trim()] || null;

export const buscarPorNombre = (nombreBuscar) => {
  if (!nombreBuscar) return null;
  const q = nombreBuscar.trim().toLowerCase();
  return Object.entries(BD_CLIENTES).find(([, v]) => v.nombre.toLowerCase().includes(q)) || null;
};

export { BD_CLIENTES };
