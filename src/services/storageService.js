// ── storageService.js ──
// Capa de abstracción para persistencia de datos.
// Principio SOLID "D" (Inversión de Dependencias):
// Los componentes no saben si los datos van a Redis, localStorage u otra BD.
// Para cambiar de proveedor, solo se modifica este archivo.
//
// IMPORTANTE: @upstash/redis NO funciona directo en el browser (frontend).
// Para conectar Vercel KV desde React, se necesita una API Route (Vercel Serverless Function).
// Por eso este servicio usa fetch hacia /api/inventario (que tú creas en Vercel).
// Si quieres una demo offline usa el fallback de localStorage que está abajo.

// ── Inventario de Pasillos ──────────────────────────────────────────────

/**
 * Guarda un registro de inventario en Vercel KV (via API Route).
 * @param {Object} datos - { fecha, hora, pasillo, lado, posOcupadas, posVacias }
 */
export async function guardarInventario(datos) {
  try {
    const res = await fetch('/api/inventario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...datos, timestamp: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true };
  } catch (err) {
    console.error('[storageService] guardarInventario:', err);
    // Fallback: guarda en localStorage si la API no está disponible
    _localSave('historial_inventario', datos);
    return { ok: false, error: err.message };
  }
}

/**
 * Obtiene el historial de inventario desde Vercel KV (via API Route).
 */
export async function obtenerHistorialInventario() {
  try {
    const res = await fetch('/api/inventario');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.historial || [];
  } catch (err) {
    console.error('[storageService] obtenerHistorial:', err);
    // Fallback: lee desde localStorage
    return _localRead('historial_inventario');
  }
}

// ── Helpers localStorage (fallback / desarrollo local) ──────────────────
function _localSave(key, datos) {
  try {
    const prev = _localRead(key);
    prev.unshift({ ...datos, timestamp: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(prev.slice(0, 200))); // máx 200 registros
  } catch (_) { /* storage lleno o bloqueado */ }
}

function _localRead(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (_) { return []; }
}
