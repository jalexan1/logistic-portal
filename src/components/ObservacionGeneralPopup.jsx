// ── ObservacionGeneralPopup.jsx ──────────────────────────────────────────
// 06-nov (req. 5): antes de radicar (registro manual, plantilla Excel o PDF)
// se pide una observación general para TODO el pedido.
//   · «Continuar con observaciones» → la caja de texto es obligatoria.
//   · «Sin observaciones»           → se radica con la observación vacía.
//   · «Cancelar»                    → vuelve a la pantalla sin radicar.
// Se guarda en despachos.solicitudes.observaciones y en la traza (evento
// RADICADA) — SQL 034.
// ─────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from "react";

export const MIN_OBSERVACION = 5;

export default function ObservacionGeneralPopup({ inicial = "", trabajando = false, onContinuar, onCancelar }) {
  const [modo, setModo] = useState(inicial ? "con" : null);   // null | "con"
  const [texto, setTexto] = useState(inicial);
  const [error, setError] = useState("");
  const caja = useRef(null);

  useEffect(() => { if (modo === "con") caja.current?.focus(); }, [modo]);
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape" && !trabajando) onCancelar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCancelar, trabajando]);

  const continuarCon = () => {
    if (modo !== "con") { setModo("con"); return; }
    const t = texto.replace(/\s+/g, " ").trim();
    if (t.length < MIN_OBSERVACION) { setError(`Escriba la observación (mínimo ${MIN_OBSERVACION} caracteres) o elija «Sin observaciones».`); caja.current?.focus(); return; }
    onContinuar(t);
  };

  const btn = { height: 40, padding: "0 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: trabajando ? "wait" : "pointer", whiteSpace: "nowrap" };

  return (
    <div onClick={() => !trabajando && onCancelar()} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(10,30,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="obs-titulo" onClick={e => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, overflow: "hidden", boxShadow: "0 28px 70px rgba(0,0,0,0.25)" }}>
        <div style={{ background: "#F2F8F5", borderBottom: "1px solid #E2EDE9", padding: "16px 22px", display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "#0F6E56", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>📝</div>
          <div>
            <div id="obs-titulo" style={{ fontSize: 15.5, fontWeight: 700, color: "#1a2e27" }}>Observación general del pedido</div>
            <div style={{ fontSize: 11.5, color: "#6B8F80" }}>Aplica a todo el pedido. Queda guardada con la solicitud y en su historial.</div>
          </div>
        </div>

        <div style={{ padding: "16px 22px 4px" }}>
          {modo === "con" ? (
            <>
              <label htmlFor="obs-texto" style={{ fontSize: 12, fontWeight: 600, color: "#44574F" }}>Observaciones *</label>
              <textarea id="obs-texto" ref={caja} value={texto} rows={4} maxLength={1000} disabled={trabajando}
                onChange={e => { setTexto(e.target.value); setError(""); }}
                placeholder="Ej.: Entregar antes de las 10 a. m. · Cliente recibe solo con orden de compra · Pedido urgente"
                style={{ width: "100%", marginTop: 6, padding: 10, fontSize: 13.5, fontFamily: "inherit", border: `1px solid ${error ? "#E5B935" : "#D4E5DE"}`, background: error ? "#FFF3BF" : "#fff", borderRadius: 10, boxSizing: "border-box", resize: "vertical", outline: "none" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9CB8AE", marginTop: 4 }}>
                <span>{error ? <span style={{ color: "#C0392B" }}>⚠ {error}</span> : "Escriba las indicaciones específicas del pedido."}</span>
                <span>{texto.length}/1000</span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13.5, color: "#1a2e27", lineHeight: 1.6, marginBottom: 8 }}>
              ¿Desea agregar una observación general para todo el pedido antes de radicarlo?
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "14px 22px 18px", flexWrap: "wrap" }}>
          <button onClick={onCancelar} disabled={trabajando} style={{ ...btn, background: "#fff", color: "#6B8F80", border: "1px solid #E2EDE9" }}>Cancelar</button>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => onContinuar("")} disabled={trabajando} style={{ ...btn, background: "#fff", color: "#0F6E56", border: "1px solid #C5DDD4" }}>Sin observaciones</button>
            <button onClick={continuarCon} disabled={trabajando} style={{ ...btn, background: "#0F6E56", color: "#fff", border: "none" }}>
              {trabajando ? "Radicando…" : modo === "con" ? "Continuar y radicar" : "Continuar con observaciones"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
