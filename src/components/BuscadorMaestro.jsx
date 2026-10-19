// ── BuscadorMaestro.jsx ──────────────────────────────────────────────────
// Popup de búsqueda (lupa) sobre un maestro, con filtros por campo y comodines.
//   tipo="destinatario" → core.destinatarios (NIT, nombre, ciudad…)
//   tipo="item"         → core.item_ean (Item, EAN, descripción)
// "*" o "%" = cualquier texto en medio (ej. "bell*group"); siempre busca "contiene".
// Al elegir una fila llama onElegir(fila) y se cierra.
// ─────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from "react";
import { buscarDestinatarios, buscarItems } from "../services/maestrosService";

const CONFIG = {
  destinatario: {
    titulo: "Buscar destinatario",
    filtros: [["nit", "NIT"], ["nombre", "Nombre"], ["ciudad", "Ciudad"]],
    columnas: [["nit", "NIT", 110], ["nombre", "Nombre", 260], ["direccion", "Dirección", 200], ["ciudad", "Ciudad", 120], ["departamento", "Departamento", 120]],
    buscar: buscarDestinatarios,
  },
  item: {
    titulo: "Buscar ítem / EAN",
    filtros: [["item", "Item (SKU)"], ["ean", "EAN"], ["descripcion", "Descripción"]],
    columnas: [["item", "Item (SKU)", 120], ["ean", "EAN", 140], ["descripcion", "Descripción", 340]],
    buscar: buscarItems,
  },
};

export default function BuscadorMaestro({ tipo, inicial = {}, onElegir, onCerrar }) {
  const cfg = CONFIG[tipo];
  const [filtros, setFiltros] = useState(() => Object.fromEntries(cfg.filtros.map(([k]) => [k, inicial[k] || ""])));
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const primero = useRef(null);

  const buscar = async (f = filtros) => {
    setCargando(true); setError("");
    try { setFilas(await cfg.buscar(f)); }
    catch (e) { setError(e.message); setFilas([]); }
    finally { setCargando(false); }
  };

  // Búsqueda inicial con lo que traía la celda
  useEffect(() => { buscar(); primero.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCerrar]);

  const campo = { height: 34, padding: "0 10px", fontSize: 13, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#1a2e27", outline: "none", boxSizing: "border-box", width: "100%" };

  return (
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(10,30,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 860, maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 28px 70px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #E2EDE9" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2e27" }}>🔍 {cfg.titulo}</div>
            <div style={{ fontSize: 11, color: "#6B8F80" }}>Escriba parte del texto; use * para saltar palabras (ej. <b>bell*group</b>). Enter para buscar.</div>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ width: 32, height: 32, border: "1px solid #E2EDE9", borderRadius: 8, background: "#fff", color: "#6B8F80", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>

        <form onSubmit={e => { e.preventDefault(); buscar(); }}
          style={{ display: "grid", gridTemplateColumns: `repeat(${cfg.filtros.length}, 1fr) auto`, gap: 8, padding: "12px 18px", alignItems: "end" }}>
          {cfg.filtros.map(([k, etiqueta], i) => (
            <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#6B8F80", fontWeight: 500 }}>
              {etiqueta}
              <input ref={i === 0 ? primero : null} value={filtros[k]} onChange={e => setFiltros(f => ({ ...f, [k]: e.target.value }))} style={campo} />
            </label>
          ))}
          <button type="submit" style={{ height: 34, padding: "0 16px", fontSize: 13, fontWeight: 600, border: "none", borderRadius: 8, background: "#0F6E56", color: "#fff", cursor: "pointer" }}>Buscar</button>
        </form>

        <div style={{ overflow: "auto", flex: 1, borderTop: "1px solid #E2EDE9" }}>
          {error && <div style={{ padding: 14, fontSize: 12, color: "#C0392B" }}>⚠ {error}</div>}
          {cargando && <div style={{ padding: 14, fontSize: 13, color: "#6B8F80" }}>Buscando…</div>}
          {!cargando && !error && filas.length === 0 && <div style={{ padding: 20, fontSize: 13, color: "#9CB8AE", textAlign: "center" }}>Sin resultados. Ajuste los filtros o use * como comodín.</div>}
          {!cargando && filas.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead style={{ position: "sticky", top: 0 }}>
                <tr>{cfg.columnas.map(([k, t, w]) => <th key={k} style={{ minWidth: w, textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 600, color: "#6B8F80", textTransform: "uppercase", letterSpacing: ".06em", background: "#F7FCF9", borderBottom: "1px solid #E2EDE9" }}>{t}</th>)}</tr>
              </thead>
              <tbody>{filas.map((f, i) => (
                <tr key={i} onClick={() => { onElegir(f); onCerrar(); }} style={{ cursor: "pointer", borderBottom: "1px solid #F0F5F3" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#EAF7F1"} onMouseLeave={e => e.currentTarget.style.background = ""}>
                  {cfg.columnas.map(([k]) => <td key={k} style={{ padding: "8px 10px", color: f[k] ? "#1a2e27" : "#C9D6D0" }}>{f[k] || "—"}</td>)}
                </tr>))}</tbody>
            </table>
          )}
        </div>
        <div style={{ padding: "8px 18px", fontSize: 11, color: "#9CB8AE", borderTop: "1px solid #E2EDE9" }}>
          {filas.length >= 100 ? "Se muestran los primeros 100 resultados: afine la búsqueda." : `${filas.length} resultado${filas.length !== 1 ? "s" : ""} · clic en una fila para usarla`}
        </div>
      </div>
    </div>
  );
}
