// ── Paginador.jsx ────────────────────────────────────────────────────────
// Pie de tabla: "Filas por página" + navegación.
// Opciones por defecto 5, 10, 15, 30, 50, 80, 150 (prop `opciones` para cambiarlas).
// Controlado: el padre guarda `pagina` (desde 1) y `porPagina`.
// ─────────────────────────────────────────────────────────────────────────
import React from "react";

const OPCIONES_POR_PAGINA = [5, 10, 15, 30, 50, 80, 150];

export default function Paginador({ total, pagina, porPagina, onPagina, onPorPagina, unidad = "filas", opciones = OPCIONES_POR_PAGINA }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const actual = Math.min(Math.max(1, pagina), paginas);
  const desde = total === 0 ? 0 : (actual - 1) * porPagina + 1;
  const hasta = Math.min(total, actual * porPagina);

  const btn = (deshabilitado) => ({
    minWidth: 34, height: 32, padding: "0 8px", fontSize: 13, fontWeight: 600, borderRadius: 8,
    border: "1px solid #D4E5DE", background: deshabilitado ? "#F4F7F6" : "#fff",
    color: deshabilitado ? "#B9CCC4" : "#0F6E56", cursor: deshabilitado ? "default" : "pointer",
  });

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "10px 16px", borderTop: "1px solid #E2EDE9", background: "#FBFDFC" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#44574F" }}>
        Filas por página
        <select value={porPagina} onChange={e => onPorPagina(Number(e.target.value))}
          style={{ height: 32, padding: "0 28px 0 10px", fontSize: 13, fontWeight: 600, border: "1px solid #C5DDD4", borderRadius: 8, color: "#0F6E56", cursor: "pointer",
            background: "#fff url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%230F6E56' stroke-width='1.6' fill='none'/%3E%3C/svg%3E\") no-repeat right 10px center" }}>
          {opciones.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <span style={{ fontSize: 12, color: "#6B8F80" }}>
        {total === 0 ? `0 ${unidad}` : `${desde.toLocaleString("es-CO")}–${hasta.toLocaleString("es-CO")} de ${total.toLocaleString("es-CO")} ${unidad}`}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button onClick={() => onPagina(1)} disabled={actual <= 1} style={btn(actual <= 1)} title="Primera página">«</button>
        <button onClick={() => onPagina(actual - 1)} disabled={actual <= 1} style={btn(actual <= 1)} title="Anterior">‹</button>
        <span style={{ fontSize: 12, color: "#44574F", padding: "0 6px", whiteSpace: "nowrap" }}>Página <b>{actual}</b> de {paginas}</span>
        <button onClick={() => onPagina(actual + 1)} disabled={actual >= paginas} style={btn(actual >= paginas)} title="Siguiente">›</button>
        <button onClick={() => onPagina(paginas)} disabled={actual >= paginas} style={btn(actual >= paginas)} title="Última página">»</button>
      </div>
    </div>
  );
}
