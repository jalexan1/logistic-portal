// ── AdjuntosBoton.jsx ────────────────────────────────────────────────────
// Botón 📎 de una solicitud: muestra cuántos adjuntos tiene (.zip, imágenes,
// QR) y al hacer clic los lista para descargarlos. Se usa en "Solicitudes de
// hoy" (pantalla Despachos) y en el Histórico.
// ─────────────────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { descargarAdjunto, tamanoLegible } from "../services/adjuntosService";

export default function AdjuntosBoton({ adjuntos = [], numero, onError }) {
  const [abierto, setAbierto] = useState(false);
  if (!adjuntos.length) return <span title="Sin adjuntos" style={{ color: "#C9D6D0", fontSize: 12 }}>—</span>;

  const bajar = async (a) => { try { await descargarAdjunto(a, numero); } catch (e) { if (onError) onError("⚠ " + e.message); } };
  const bajarTodos = async () => { for (const a of adjuntos) { await bajar(a); await new Promise(r => setTimeout(r, 450)); } };

  return (
    <>
      <button onClick={() => (adjuntos.length === 1 ? bajar(adjuntos[0]) : setAbierto(true))}
        title={adjuntos.length === 1 ? `Descargar ${adjuntos[0].nombre}` : `${adjuntos.length} adjuntos`}
        style={{ height: 28, padding: "0 9px", fontSize: 11, fontWeight: 600, border: "1px solid #D4E5DE", borderRadius: 7, background: "#fff", color: "#0F6E56", cursor: "pointer", whiteSpace: "nowrap" }}>
        📎 {adjuntos.length}
      </button>
      {abierto && (
        <div onClick={() => setAbierto(false)} style={{ position: "fixed", inset: 0, zIndex: 2600, background: "rgba(10,30,24,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 440, padding: "16px 18px", textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2e27", marginBottom: 10 }}>📎 Adjuntos de {numero}</div>
            {adjuntos.map(a => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #F0F5F3" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#1a2e27", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.nombre}>{a.nombre}</span>
                <span style={{ fontSize: 11, color: "#9CB8AE" }}>{tamanoLegible(a.tamano_bytes)}</span>
                <button onClick={() => bajar(a)} style={{ height: 28, padding: "0 10px", fontSize: 11, fontWeight: 600, border: "1px solid #C5DDD4", borderRadius: 7, background: "#fff", color: "#0F6E56", cursor: "pointer" }}>⬇</button>
              </div>))}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={bajarTodos} style={{ height: 34, padding: "0 14px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 8, background: "#0F6E56", color: "#fff", cursor: "pointer" }}>⬇ Descargar todos</button>
              <button onClick={() => setAbierto(false)} style={{ height: 34, padding: "0 14px", fontSize: 12, fontWeight: 600, border: "1px solid #E2EDE9", borderRadius: 8, background: "#fff", color: "#6B8F80", cursor: "pointer" }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
