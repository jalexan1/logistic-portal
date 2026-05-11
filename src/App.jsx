import React, { useState, useEffect } from "react";
import PortalDespachos from "./components/PortalDespachos";
import InventarioPasillos from "./components/InventarioPasillos";

// ── Hook responsive ──
const useIsMobile = () => {
  const [m, setM] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return m;
};

// ── Definición de vistas ──
const VISTAS = [
  {
    id: "despachos",
    label: "Portal de despachos",
    labelCorto: "Despachos",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M5 3V2.5A1.5 1.5 0 0 1 6.5 1h3A1.5 1.5 0 0 1 11 2.5V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <path d="M5.5 8h5M5.5 10.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: "inventario",
    label: "Inventario de Pasillos",
    labelCorto: "Inventario",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="9" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
];

// ══════════════════════════════════════
// ── APP: Orquestador principal ──
// ══════════════════════════════════════
export default function App() {
  const isMobile = useIsMobile();
  const [vista, setVista] = useState("despachos");

  const vistaActual = VISTAS.find(v => v.id === vista);

  return (
    <div style={{ minHeight: "100vh", background: "#F7F9F8", fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>

      {/* ── Header ── */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #E2EDE9",
        padding: "0 16px", position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 1140, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>

          {/* Logo + nombre empresa */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#0F6E56", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
                <rect x="2" y="3" width="14" height="2" rx="1" fill="white"/>
                <rect x="2" y="8" width="14" height="2" rx="1" fill="white"/>
                <rect x="2" y="13" width="9" height="2" rx="1" fill="white"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: 600, color: "#0F6E56", lineHeight: 1.2 }}>
                Logistics and Services
              </div>
              {!isMobile && (
                <div style={{ fontSize: 11, color: "#6B8F80" }}>
                  {vistaActual?.label}
                </div>
              )}
            </div>
          </div>

          {/* Navegación de pestañas */}
          <nav style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {VISTAS.map(v => {
              const activo = vista === v.id;
              return (
                <button key={v.id} onClick={() => setVista(v.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: isMobile ? "6px 10px" : "7px 14px",
                    fontSize: isMobile ? 11 : 12, fontWeight: activo ? 700 : 500,
                    border: activo ? "1px solid #0F6E56" : "1px solid #E2EDE9",
                    borderRadius: 9,
                    background: activo ? "#0F6E56" : "#fff",
                    color: activo ? "#fff" : "#6B8F80",
                    cursor: "pointer",
                    transition: "all 0.18s",
                  }}
                  onMouseEnter={e => { if (!activo) { e.currentTarget.style.background = "#F2F8F5"; e.currentTarget.style.color = "#0F6E56"; e.currentTarget.style.borderColor = "#C5DDD4"; } }}
                  onMouseLeave={e => { if (!activo) { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "#6B8F80"; e.currentTarget.style.borderColor = "#E2EDE9"; } }}
                >
                  <span style={{ color: activo ? "#fff" : "#9CB8AE" }}>{v.icon}</span>
                  {isMobile ? v.labelCorto : v.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* ── Contenido de la vista activa ── */}
      <div style={{ maxWidth: 1140, margin: "0 auto", padding: isMobile ? "16px 12px 0" : "24px 24px 0" }}>
        {vista === "despachos" && <PortalDespachos isMobile={isMobile} />}
        {vista === "inventario" && <InventarioPasillos isMobile={isMobile} />}
      </div>

    </div>
  );
}
