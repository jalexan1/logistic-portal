// ── storageService.js ──
// Persistencia de Inventario de Pasillos en Supabase (inventario.registros_pasillo).
// ANTES: lista completa en Redis que se reescribía en cada edición/borrado
// (último en guardar borraba al otro, tope de 500, respaldo en localStorage).
// AHORA: una fila por registro, edición con bloqueo optimista (version),
// anulación lógica con motivo (nunca DELETE) y auditoría en core.auditoria.
//
// Se conserva la "forma" de los registros que usa InventarioPasillos.jsx:
// { id, version, fecha:'dd/mm/aaaa', hora:'HH:MM', pasillo, posOcupadas, posVacias, usuario, observaciones }

import { inventario } from '../lib/supabase';
import { fechaBogota, horaBogota } from '../utils/fechas';
import { mensajeError } from './solicitudesService';

let _pasillos = null; // codigo → id

async function pasilloId(codigo) {
  if (!_pasillos) {
    const { data, error } = await inventario().from('pasillos').select('id,codigo').eq('activo', true);
    if (error) throw new Error(mensajeError(error));
    _pasillos = Object.fromEntries(data.map(p => [p.codigo, p.id]));
  }
  const id = _pasillos[codigo];
  if (!id) throw new Error(`Pasillo ${codigo} no existe en el catálogo`);
  return id;
}

const aRegistro = (r) => ({
  id: r.id, version: r.version,
  fecha: fechaBogota(r.registrado_at), hora: horaBogota(r.registrado_at),
  pasillo: r.pasillo, posOcupadas: r.posiciones_ocupadas, posVacias: r.posiciones_vacias,
  usuario: r.usuario_operativo || '', observaciones: r.observaciones || '',
  registradoPor: r.registrado_por,
});

// ── LEER (vigentes, más recientes primero) ───────────────
export async function obtenerHistorialInventario({ limite = 2000 } = {}) {
  const { data, error } = await inventario().from('vw_registros_pasillo')
    .select('id,version,pasillo,registrado_at,posiciones_ocupadas,posiciones_vacias,usuario_operativo,observaciones,registrado_por')
    .is('anulado_at', null).order('registrado_at', { ascending: false }).limit(limite);
  if (error) throw new Error(mensajeError(error));
  return data.map(aRegistro);
}

// ── CREAR ────────────────────────────────────────────────
export async function guardarInventario(datos) {
  try {
    const { data, error } = await inventario().from('registros_pasillo').insert({
      pasillo_id: await pasilloId(datos.pasillo),
      posiciones_ocupadas: datos.posOcupadas,
      posiciones_vacias: datos.posVacias,
      usuario_operativo: datos.usuario || null,
      observaciones: datos.observaciones || null,
    }).select('id').single();
    if (error) throw error;
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: mensajeError(err) };
  }
}

// ── ACTUALIZAR (bloqueo optimista por version) ───────────
export async function actualizarInventario(registro, datos) {
  try {
    const { data, error } = await inventario().from('registros_pasillo').update({
      pasillo_id: await pasilloId(datos.pasillo),
      posiciones_ocupadas: datos.posOcupadas,
      posiciones_vacias: datos.posVacias,
      usuario_operativo: datos.usuario || null,
      observaciones: datos.observaciones || null,
    }).eq('id', registro.id).eq('version', registro.version).select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      return { ok: false, conflicto: true, error: 'Otro usuario modificó este registro (o ya no tiene permiso para editarlo). Se recargó la información.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: mensajeError(err) };
  }
}

// ── ANULAR (reemplaza al borrado; queda en auditoría) ────
export async function anularInventario(registro, motivo) {
  try {
    const { data, error } = await inventario().from('registros_pasillo').update({
      anulado_at: new Date().toISOString(),
      motivo_anulacion: motivo,
    }).eq('id', registro.id).eq('version', registro.version).select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      return { ok: false, conflicto: true, error: 'No se pudo anular: el registro cambió o no tiene permiso (el registrador solo anula lo suyo durante 24 h).' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: mensajeError(err) };
  }
}
