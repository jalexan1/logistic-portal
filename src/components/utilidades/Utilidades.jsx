// ── Utilidades.jsx ────────────────────────────────────────────────────────
// Responsabilidad única: menú y enrutamiento interno del módulo Utilidades.
// Extensible: para agregar una nueva utilidad basta con añadir una entrada
// al array UTILIDADES y crear su componente — sin tocar nada más.
// ─────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import ExtraccionPickingPdf from './ExtraccionPickingPdf';

// ── Registro de utilidades disponibles ───────────────────────────────────
// Para agregar una nueva: { id, icono, titulo, descripcion, componente }
const UTILIDADES = [
  {
    id:          'extraccion-picking',
    icono:       '📄',
    titulo:      'Extracción Datos Picking',
    descripcion: 'Lee PDFs escaneados y extrae Picking No + Fecha de Impresión. Descarga los resultados en Excel con detección automática de duplicados.',
    componente:  <ExtraccionPickingPdf />,
  },
  // Próximas utilidades se agregan aquí
];

// ── Paleta (coherente con el portal, valores propios de este módulo) ──────
const C = {
  verde:  '#0F6E56',
  borde:  '#E2EDE9',
  bg:     '#F7F9F8',
  texto:  '#1A2E27',
  sub:    '#6B8F80',
  blanco: '#FFFFFF',
};

// ── Tarjeta de selección de utilidad ─────────────────────────────────────
function TarjetaUtilidad({ util, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? '#F2F8F5' : C.blanco,
        border: `1.5px solid ${hover ? C.verde : C.borde}`,
        borderRadius: 12, padding: '20px 22px',
        cursor: 'pointer', transition: 'all 0.18s',
        display: 'flex', alignItems: 'flex-start', gap: 14,
        maxWidth: 420,
      }}
    >
      <div style={{
        fontSize: 26, width: 48, height: 48, borderRadius: 10,
        background: hover ? '#E1F5EE' : C.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, transition: 'background 0.18s',
      }}>
        {util.icono}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.texto, marginBottom: 4 }}>
          {util.titulo}
        </div>
        <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
          {util.descripcion}
        </div>
        <div style={{ fontSize: 11, color: C.verde, fontWeight: 600, marginTop: 8 }}>
          Abrir →
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────
export default function Utilidades({ isMobile }) {
  const [utilActiva, setUtilActiva] = useState(null);

  const utilSeleccionada = UTILIDADES.find(u => u.id === utilActiva);

  return (
    <div style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif", color: C.texto }}>

      {/* ── Breadcrumb / navegación interna ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, fontSize: 12, color: C.sub }}>
        <span
          style={{ cursor: utilActiva ? 'pointer' : 'default', color: utilActiva ? C.verde : C.sub, fontWeight: utilActiva ? 600 : 400 }}
          onClick={() => setUtilActiva(null)}
        >
          Utilidades
        </span>
        {utilSeleccionada && (
          <>
            <span style={{ color: C.borde }}>›</span>
            <span style={{ color: C.texto, fontWeight: 600 }}>{utilSeleccionada.titulo}</span>
          </>
        )}
      </div>

      {/* ── Vista: menú de utilidades ── */}
      {!utilActiva && (
        <>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: C.texto, margin: 0 }}>
              Utilidades
            </h2>
            <p style={{ fontSize: 12, color: C.sub, margin: '4px 0 0' }}>
              Herramientas de apoyo para la operación logística. Selecciona una utilidad para comenzar.
            </p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            {UTILIDADES.map(u => (
              <TarjetaUtilidad
                key={u.id}
                util={u}
                onClick={() => setUtilActiva(u.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* ── Vista: utilidad activa ── */}
      {utilActiva && utilSeleccionada && (
        <div>
          <button
            onClick={() => setUtilActiva(null)}
            style={{
              background: 'none', border: `1px solid ${C.borde}`,
              borderRadius: 8, padding: '6px 14px', fontSize: 12,
              color: C.sub, cursor: 'pointer', marginBottom: 20,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            ← Volver a Utilidades
          </button>
          {utilSeleccionada.componente}
        </div>
      )}
    </div>
  );
}
