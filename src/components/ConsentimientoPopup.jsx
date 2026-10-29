// ── ConsentimientoPopup.jsx ──────────────────────────────────────────────
// Alerta de inventario antes de cargar un pedido (Excel o PDF).
// «Continuar» solo se habilita al marcar «Leí y acepto». La aceptación se
// registra en la base (SQL 032) desde PortalDespachos.
// ─────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { textoVigente, TEXTO_RESPALDO } from "../services/consentimientoService";

export default function ConsentimientoPopup({ origen, trabajando = false, onAceptar, onCancelar }) {
  const [texto, setTexto] = useState(TEXTO_RESPALDO);
  const [acepto, setAcepto] = useState(false);

  useEffect(() => { let vivo = true; textoVigente().then(t => { if (vivo) setTexto(t); }).catch(() => {}); return () => { vivo = false; }; }, []);

  // Una oración por párrafo para que se lea fácil
  const parrafos = String(texto.texto || "").split(/(?<=\.)\s+/).filter(Boolean);

  return (
    <div onClick={() => !trabajando && onCancelar()} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(10,30,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="consent-titulo" onClick={e => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, overflow: "hidden", boxShadow: "0 28px 70px rgba(0,0,0,0.25)" }}>
        <div style={{ background: "#FFFBEB", borderBottom: "1px solid #FCD9A0", padding: "16px 22px", display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "#F59E0B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>⚠️</div>
          <div>
            <div id="consent-titulo" style={{ fontSize: 15.5, fontWeight: 700, color: "#92400E" }}>{texto.titulo}</div>
            <div style={{ fontSize: 11.5, color: "#B45309" }}>Antes de cargar el pedido {origen === "PDF" ? "desde PDF" : "con la plantilla Excel"}</div>
          </div>
        </div>

        <div style={{ padding: "16px 22px 6px", fontSize: 13.5, color: "#1a2e27", lineHeight: 1.6 }}>
          {parrafos.map((t, i) => <p key={i} style={{ margin: "0 0 10px" }}>{t}</p>)}
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 22px 16px", padding: "12px 14px", border: `1.5px solid ${acepto ? "#0F6E56" : "#E2EDE9"}`, borderRadius: 10, background: acepto ? "#F0FAF6" : "#FAFCFB", cursor: "pointer", userSelect: "none" }}>
          <span role="checkbox" aria-checked={acepto} tabIndex={0}
            onKeyDown={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setAcepto(v => !v); } }}
            style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${acepto ? "#0F6E56" : "#9CB8AE"}`, background: acepto ? "#0F6E56" : "#fff", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
            {acepto ? "✓" : ""}
          </span>
          <input type="checkbox" checked={acepto} onChange={e => setAcepto(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 1, height: 1 }} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1a2e27" }}>Leí y acepto</span>
          <span style={{ fontSize: 11, color: "#6B8F80", marginLeft: "auto" }}>Queda registrado con su usuario, fecha y hora</span>
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 22px 18px", borderTop: "1px solid #F0F5F3" }}>
          <button onClick={onCancelar} disabled={trabajando}
            style={{ height: 38, padding: "0 18px", borderRadius: 10, background: "#fff", color: "#6B8F80", border: "1px solid #E2EDE9", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
          <button onClick={() => onAceptar(texto)} disabled={!acepto || trabajando}
            style={{ height: 38, padding: "0 22px", borderRadius: 10, background: acepto ? "#0F6E56" : "#A9C9BD", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: acepto && !trabajando ? "pointer" : "not-allowed" }}>
            {trabajando ? "Registrando…" : "Continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}
