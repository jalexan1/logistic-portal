// ── clientesService.js ───────────────────────────────────────────────────
// Maestro de destinatarios. ANTES: ~1.100 NIT/cédulas con nombre quemados en
// este archivo y publicados en el JS (sin login). AHORA: se leen de
// core.destinatarios, protegido por login y RLS, al iniciar sesión.
//
// Se conserva la misma interfaz (BD_CLIENTES como objeto nit → {nombre, ciudad,
// direccion, departamento, telefono},
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
      .select("nit,nombre,ciudad,direccion,departamento,telefono,estado_revision").eq("activo", true)
      .order("nit").range(desde, desde + PAGINA - 1);
    if (error) throw new Error("No se pudo cargar el maestro de destinatarios: " + error.message);
    data.forEach(d => { nuevos[String(d.nit).trim()] = { nombre: d.nombre, ciudad: d.ciudad || "", direccion: d.direccion || "", departamento: d.departamento || "", telefono: d.telefono || "", estado_revision: d.estado_revision || "APROBADO" }; });
    if (data.length < PAGINA) break;
  }
  Object.keys(BD_CLIENTES).forEach(k => delete BD_CLIENTES[k]);
  Object.assign(BD_CLIENTES, nuevos);
  cargadoEn = Date.now();
  return Object.keys(BD_CLIENTES).length;
}

// Cliente recién creado desde el popup de Despachos: queda disponible de
// inmediato para autocompletar y validar NIT / nombre en la pantalla.
export const registrarCliente = (nit, c) => {
  BD_CLIENTES[String(nit).trim()] = {
    nombre: c.nombre, ciudad: c.ciudad || "", direccion: c.direccion || "",
    departamento: c.departamento || "", telefono: c.telefono || "", estado_revision: c.estado_revision || "PENDIENTE",
  };
};

export const buscarPorNit = (nit) => BD_CLIENTES[String(nit).trim()] || null;

const normNombre = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// Coincidencia EXACTA del nombre (sin importar mayúsculas ni espacios dobles) → [nit, datos] | null
export const buscarNombreExacto = (nombreBuscar) => {
  const q = normNombre(nombreBuscar);
  if (!q) return null;
  return Object.entries(BD_CLIENTES).find(([, v]) => normNombre(v.nombre) === q) || null;
};

// Primero exacto; si no, el primer nombre que CONTIENE el texto (lectura del PDF)
export const buscarPorNombre = (nombreBuscar) => {
  if (!nombreBuscar) return null;
  const exacto = buscarNombreExacto(nombreBuscar);
  if (exacto) return exacto;
  const q = normNombre(nombreBuscar);
  return Object.entries(BD_CLIENTES).find(([, v]) => normNombre(v.nombre).includes(q)) || null;
};

export { BD_CLIENTES };
