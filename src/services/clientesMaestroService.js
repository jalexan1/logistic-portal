// ── clientesMaestroService.js ────────────────────────────────────────────
// Maestro de clientes (core.destinatarios) — fase 5 (SQL 022):
//  · Búsqueda por PARECIDO (lupa de Despachos): tildes, S.A.S, errores menores.
//  · Crear cliente desde Despachos (popup): queda PENDIENTE de revisión y se
//    puede radicar con él de inmediato. Cualquier rol de Despachos.
//  · Pantalla Clientes (solo operador = supervisor, y admin): listar, crear,
//    editar, revisar (aprobar / rechazar con nota), inactivar y borrar.
// Todas las escrituras pasan por funciones de la base que validan rol y NIT.
// ─────────────────────────────────────────────────────────────────────────
import { core, despachos } from "../lib/supabase";
import { mensajeError } from "./solicitudesService";
import { registrarCliente } from "./clientesService";

const fila = (data) => (Array.isArray(data) ? data[0] : data);

/** Clientes parecidos al texto (nombre o NIT), del más parecido al menos. */
export async function buscarClientesParecidos(texto, limite = 100) {
  const { data, error } = await despachos().rpc("fn_buscar_clientes_parecidos", { p_texto: texto, p_limite: limite });
  if (error) throw new Error(mensajeError(error));
  return data || [];
}

/** Popup de Despachos: crea el cliente PENDIENTE y lo deja disponible en pantalla. */
export async function crearClienteDespachos({ nit, nombre, direccion, ciudad, departamento, telefono }) {
  const { data, error } = await despachos().rpc("fn_crear_cliente_despachos", {
    p_nit: nit, p_nombre: nombre, p_direccion: direccion || null, p_ciudad: ciudad || null,
    p_departamento: departamento || null, p_telefono: telefono || null,
  });
  if (error) throw new Error(mensajeError(error));
  const c = fila(data);
  registrarCliente(c.nit, c);       // ya se puede usar en las validaciones de la pantalla
  return c;
}

const COLUMNAS = "id,nit,nombre,direccion,ciudad,departamento,telefono,activo,estado_revision,origen,creado_por_nombre,created_at,revisado_at,revisado_por_nombre,nota_revision,version";

/** Todos los clientes (paginado de a 1000, límite del API). */
export async function listarClientes() {
  const todos = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await core().from("destinatarios").select(COLUMNAS)
      .order("nombre").range(desde, desde + 999);
    if (error) throw new Error(mensajeError(error));
    todos.push(...data);
    if (data.length < 1000) break;
  }
  return todos;
}

/** Crear (id null) o editar. `version` evita pisar cambios de otro usuario. */
export async function guardarCliente({ id = null, nit, nombre, direccion, ciudad, departamento, telefono, version = null }) {
  const { data, error } = await despachos().rpc("fn_guardar_cliente", {
    p_id: id, p_nit: nit, p_nombre: nombre, p_direccion: direccion || null, p_ciudad: ciudad || null,
    p_departamento: departamento || null, p_telefono: telefono || null, p_version: version,
  });
  if (error) throw new Error(mensajeError(error));
  return data;
}

export async function revisarCliente({ id, aprobar, nota }) {
  const { data, error } = await despachos().rpc("fn_revisar_cliente", { p_id: id, p_aprobar: aprobar, p_nota: nota });
  if (error) throw new Error(mensajeError(error));
  return data;
}

export async function cambiarActivoCliente({ id, activo }) {
  const { error } = await despachos().rpc("fn_inactivar_cliente", { p_id: id, p_activo: activo });
  if (error) throw new Error(mensajeError(error));
}

/** Borrado definitivo (la base lo bloquea si el cliente tiene solicitudes). */
export async function borrarCliente(id) {
  const { error } = await despachos().rpc("fn_borrar_cliente", { p_id: id });
  if (error) throw new Error(mensajeError(error));
}
