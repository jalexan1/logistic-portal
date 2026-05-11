// ── storageService.js ──
// Capa de abstracción para persistencia en Vercel KV (Redis/Upstash).
// Los componentes llaman estas funciones sin saber nada de la BD.

const API = '/api/inventario';

// ── CREAR ────────────────────────────────────────────────
export async function guardarInventario(datos) {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...datos, timestamp: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true };
  } catch (err) {
    console.error('[storageService] guardarInventario:', err);
    _localSave('historial_inventario', datos);
    return { ok: false, error: err.message };
  }
}

// ── LEER ─────────────────────────────────────────────────
export async function obtenerHistorialInventario() {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.historial || [];
  } catch (err) {
    console.error('[storageService] obtenerHistorial:', err);
    return _localRead('historial_inventario');
  }
}

// ── ELIMINAR por índice ───────────────────────────────────
// Envía el historial completo actualizado (sin el registro eliminado).
export async function eliminarInventario(historialActualizado) {
  try {
    const res = await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ historial: historialActualizado }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true };
  } catch (err) {
    console.error('[storageService] eliminarInventario:', err);
    // Fallback: sobreescribe localStorage
    try { localStorage.setItem('historial_inventario', JSON.stringify(historialActualizado)); } catch (_) {}
    return { ok: false, error: err.message };
  }
}

// ── ACTUALIZAR por índice ─────────────────────────────────
export async function actualizarInventario(historialActualizado) {
  return eliminarInventario(historialActualizado); // misma operación: reemplaza todo
}

// ── Helpers localStorage (fallback / dev local) ──────────
function _localSave(key, datos) {
  try {
    const prev = _localRead(key);
    prev.unshift({ ...datos, timestamp: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(prev.slice(0, 200)));
  } catch (_) {}
}

function _localRead(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch (_) { return []; }
}
